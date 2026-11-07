import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

export const GGUF_MAGIC = "GGUF";
export const MAX_METADATA_BYTES = 16 * 1024 * 1024;
export const MAX_DIRECTORY_ENTRIES = 20000;

export const MMPROJ_PATTERN = /(mmproj|projector|vision[_-]?encoder|clip[_-]?vision)/iu;
export const IMATRIX_PATTERN = /(imatrix|importance[_-]?matrix)/iu;

export interface GgufMetadata {
  magic: string;
  version: number;
  tensorCount: number;
  metadataKvCount: number;
  fields: Record<string, any>;
}

export interface ModelDescriptor {
  id: string;
  fileName: string;
  path: string;
  sizeBytes: number;
  format: "gguf" | "mlx";
  architecture?: string;
  contextLength?: number;
  quantization?: string;
  chatTemplate?: string;
  hasChatTemplate?: boolean;
  inferredTemplate?: string;
  projector?: string | null;
  imatrix?: string | null;
  modifiedAt: number;
}

const TEMPLATE_HEURISTICS: Array<{ pattern: RegExp; template: string }> = [
  { pattern: /deepseek/i, template: "deepseek" },
  { pattern: /qwen/i, template: "chatml" },
  { pattern: /llama-?3/i, template: "llama3" },
  { pattern: /llama-?2/i, template: "llama2" },
  { pattern: /mistral/i, template: "mistral-v3" },
  { pattern: /gemma/i, template: "gemma" },
  { pattern: /phi-?3|phi-?4/i, template: "phi3" },
];

export function inferTemplate(name: string): string | undefined {
  for (const h of TEMPLATE_HEURISTICS) {
    if (h.pattern.test(name)) return h.template;
  }
  return undefined;
}

export async function readGgufMetadata(filePath: string): Promise<GgufMetadata> {
  const handle = await open(filePath, "r");
  try {
    const fileStat = await handle.stat();
    let buffer = Buffer.alloc(0);
    let position = 0;

    async function need(end: number) {
      if (end > MAX_METADATA_BYTES) {
        throw new Error("GGUF metadata section exceeds 16 MiB");
      }
      while (buffer.length < end) {
        const want = Math.min(
          fileStat.size,
          Math.max(buffer.length + 65536, end)
        );
        if (want <= buffer.length) throw new Error("truncated GGUF header");
        const chunk = Buffer.alloc(want - buffer.length);
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, buffer.length);
        if (bytesRead <= 0) throw new Error("truncated GGUF header");
        buffer = Buffer.concat([buffer, chunk.subarray(0, bytesRead)]);
      }
    }

    async function take(size: number): Promise<Buffer> {
      await need(position + size);
      const slice = buffer.subarray(position, position + size);
      position += size;
      return slice;
    }

    async function u32(): Promise<number> {
      return (await take(4)).readUInt32LE(0);
    }

    async function u64(): Promise<number> {
      return Number((await take(8)).readBigUInt64LE(0));
    }

    async function stringValue(): Promise<string> {
      const length = await u64();
      return (await take(length)).toString("utf8");
    }

    async function valueOf(type: number): Promise<any> {
      switch (type) {
        case 0: return (await take(1)).readUInt8(0);
        case 1: return (await take(1)).readInt8(0);
        case 2: return (await take(2)).readUInt16LE(0);
        case 3: return (await take(2)).readInt16LE(0);
        case 4: return (await take(4)).readUInt32LE(0);
        case 5: return (await take(4)).readInt32LE(0);
        case 6: return (await take(4)).readFloatLE(0);
        case 7: return (await take(1))[0] !== 0;
        case 8: return await stringValue();
        case 9: {
          const itemType = await u32();
          const count = await u64();
          if (count > 50000) throw new Error(`array size ${count} exceeds safety limit`);
          const arr: any[] = [];
          for (let i = 0; i < count; i++) {
            arr.push(await valueOf(itemType));
          }
          return arr;
        }
        case 10: return Number((await take(8)).readBigUInt64LE(0));
        case 11: return Number((await take(8)).readBigInt64LE(0));
        case 12: return (await take(8)).readDoubleLE(0);
        default:
          throw new Error(`unsupported GGUF value type ${type}`);
      }
    }

    const magic = (await take(4)).toString("ascii");
    if (magic !== GGUF_MAGIC) {
      throw new Error(`not a GGUF file: magic=${magic}`);
    }

    const version = await u32();
    if (version < 2 || version > 3) {
      throw new Error(`unsupported GGUF version: ${version}`);
    }

    const tensorCount = await u64();
    const metadataKvCount = await u64();
    const fields: Record<string, any> = {};

    for (let i = 0; i < metadataKvCount; i++) {
      const key = await stringValue();
      const valType = await u32();
      fields[key] = await valueOf(valType);
    }

    return { magic, version, tensorCount, metadataKvCount, fields };
  } finally {
    await handle.close();
  }
}

export function findMatchingSidecar(
  modelPath: string,
  dirFiles: string[],
  pattern: RegExp
): string | null {
  const modelBase = basename(modelPath, extname(modelPath)).toLowerCase();
  const dir = dirname(modelPath);

  // Exact base match first, then pattern match
  for (const file of dirFiles) {
    const fLower = file.toLowerCase();
    if (pattern.test(fLower)) {
      if (fLower.includes(modelBase) || modelBase.includes(fLower.replace(/\.gguf|\.dat/g, ""))) {
        return join(dir, file);
      }
    }
  }

  // Fallback: any file matching pattern in directory
  for (const file of dirFiles) {
    if (pattern.test(file.toLowerCase())) {
      return join(dir, file);
    }
  }

  return null;
}

export async function describeGgufModel(filePath: string): Promise<ModelDescriptor> {
  const absPath = resolve(filePath);
  const st = await stat(absPath);
  const fileName = basename(absPath);
  let metadata: GgufMetadata | null = null;
  try {
    metadata = await readGgufMetadata(absPath);
  } catch {
    // If header parsing fails, return basic descriptor
  }

  const fields = metadata?.fields ?? {};
  const arch = fields["general.architecture"] as string | undefined;
  const ctx = arch ? (fields[`${arch}.context_length`] as number | undefined) : undefined;
  const chatTemplate = fields["tokenizer.chat_template"] as string | undefined;
  const quant = (fields["general.file_type"] !== undefined)
    ? String(fields["general.file_type"])
    : undefined;

  let dirFiles: string[] = [];
  try {
    dirFiles = await readdir(dirname(absPath));
  } catch {
    // Ignore
  }

  const projector = findMatchingSidecar(absPath, dirFiles, MMPROJ_PATTERN);
  const imatrix = findMatchingSidecar(absPath, dirFiles, IMATRIX_PATTERN);

  const hash = createHash("sha256").update(absPath).digest("hex").slice(0, 12);
  const id = `gguf-${hash}`;

  return {
    id,
    fileName,
    path: absPath,
    sizeBytes: st.size,
    format: "gguf",
    architecture: arch,
    contextLength: ctx,
    quantization: quant,
    chatTemplate,
    hasChatTemplate: Boolean(chatTemplate && chatTemplate.trim().length > 0),
    inferredTemplate: inferTemplate(fileName),
    projector,
    imatrix,
    modifiedAt: st.mtimeMs,
  };
}

export async function scanDirectoriesForModels(dirs: string[], maxDepth = 4): Promise<ModelDescriptor[]> {
  const models: ModelDescriptor[] = [];
  const visited = new Set<string>();

  async function walk(currentDir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const real = resolve(currentDir);
      if (visited.has(real)) return;
      visited.add(real);

      const entries = await readdir(real, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(real, entry.name);
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          // Filter out sidecars from the primary model list
          if (lower.endsWith(".gguf") && !MMPROJ_PATTERN.test(lower) && !IMATRIX_PATTERN.test(lower)) {
            try {
              const desc = await describeGgufModel(full);
              models.push(desc);
            } catch {
              // skip corrupted or incomplete file
            }
          }
        } else if (entry.isDirectory()) {
          // Skip hidden directories, trash, and git internals
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            await walk(full, depth + 1);
          }
        }
      }
    } catch {
      // directory unreadable or permission denied
    }
  }

  for (const dir of dirs) {
    await walk(dir, 0);
  }

  return models;
}
