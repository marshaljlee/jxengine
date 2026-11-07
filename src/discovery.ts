import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/**
 * Discovers bundled and system-installed llama-server and kapitsa binaries.
 * Prioritizes:
 * 1. Explicit override option / environment variable
 * 2. Host app bundled directory (Contents/Resources/llama/llama-server or process.resourcesPath)
 * 3. System PATH or Homebrew standard locations
 */
export function resolveLlamaServerBinary(overridePath?: string): string {
  // 1. Explicit override or environment variable
  if (overridePath && existsSync(overridePath)) return overridePath;
  if (process.env.BUNDLED_LLAMA_PATH && existsSync(process.env.BUNDLED_LLAMA_PATH)) {
    return process.env.BUNDLED_LLAMA_PATH;
  }

  // 2. macOS Application bundle locations (e.g. inside JXStack.app, bb.app, or electron bundle)
  const bundleCandidates = [
    join(process.cwd(), "Contents/Resources/llama/llama-server"),
    join(process.cwd(), "Resources/llama/llama-server"),
    join(process.cwd(), "../Resources/llama/llama-server"),
    join(process.cwd(), "bin/llama-server"),
    // If running under Electron or native app container
    (process as any).resourcesPath ? join((process as any).resourcesPath, "llama/llama-server") : "",
    (process as any).resourcesPath ? join((process as any).resourcesPath, "bin/llama-server") : "",
  ].filter(Boolean);

  for (const c of bundleCandidates) {
    if (existsSync(c)) return c;
  }

  // 3. Homebrew & standard system locations
  const standardCandidates = [
    "/opt/homebrew/bin/llama-server",
    "/usr/local/bin/llama-server",
    "/usr/bin/llama-server",
  ];
  for (const sc of standardCandidates) {
    if (existsSync(sc)) return sc;
  }

  // 4. PATH lookup fallback
  try {
    const fromPath = execSync("which llama-server 2>/dev/null", { encoding: "utf8" }).trim();
    if (fromPath && existsSync(fromPath)) return fromPath;
  } catch {}

  // Fallback default
  return "/opt/homebrew/bin/llama-server";
}
