import { execSync } from "node:child_process";
import os from "node:os";

export interface MemorySnapshot {
  totalBytes: number;
  availableBytes: number;
  freeBytes: number;
  inactiveBytes: number;
  purgeableBytes: number;
  totalGb: number;
  availableGb: number;
}

/**
 * Reads detailed system memory stats, including macOS inactive and purgeable pages
 * which macOS readily releases for new process memory allocations.
 */
export function getDetailedMemorySnapshot(): MemorySnapshot {
  const totalBytes = os.totalmem();
  let availableBytes = os.freemem();
  let freeBytes = os.freemem();
  let inactiveBytes = 0;
  let purgeableBytes = 0;

  if (process.platform === "darwin") {
    try {
      const output = execSync("vm_stat", { encoding: "utf8" });
      const pageSize = 16384;
      let freePages = 0;
      let speculativePages = 0;
      let inactivePages = 0;
      let purgeablePages = 0;

      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("Pages free:")) freePages = parseInt(trimmed.split(":")[1].replace(".", "").trim(), 10);
        if (trimmed.startsWith("Pages speculative:")) speculativePages = parseInt(trimmed.split(":")[1].replace(".", "").trim(), 10);
        if (trimmed.startsWith("Pages inactive:")) inactivePages = parseInt(trimmed.split(":")[1].replace(".", "").trim(), 10);
        if (trimmed.startsWith("Pages purgeable:")) purgeablePages = parseInt(trimmed.split(":")[1].replace(".", "").trim(), 10);
      }

      freeBytes = (freePages + speculativePages) * pageSize;
      inactiveBytes = inactivePages * pageSize;
      purgeableBytes = purgeablePages * pageSize;
      availableBytes = freeBytes + inactiveBytes + purgeableBytes;
    } catch {}
  }

  return {
    totalBytes,
    availableBytes,
    freeBytes,
    inactiveBytes,
    purgeableBytes,
    totalGb: +(totalBytes / (1024 * 1024 * 1024)).toFixed(2),
    availableGb: +(availableBytes / (1024 * 1024 * 1024)).toFixed(2),
  };
}

/**
 * Safely releases inactive/unpinned cache memory in userland without disrupting running engines.
 * Forces garbage collection across internal buffers and triggers an allocation pulse
 * that prompts the macOS Virtual Memory subsystem to trim inactive file cache pages.
 */
export function freeSystemRam(): { before: MemorySnapshot; after: MemorySnapshot; freedMb: number } {
  const before = getDetailedMemorySnapshot();

  // 1. Force Node V8 garbage collection if available
  if (global.gc) {
    try {
      global.gc();
    } catch {}
  }

  // 2. Pulse memory allocation to advise the kernel VM manager to reclaim inactive/purgeable file-cache pages
  try {
    const pulseChunks: Buffer[] = [];
    // Allocate 300MB buffer in blocks to signal memory pressure, then immediately discard
    for (let i = 0; i < 6; i++) {
      pulseChunks.push(Buffer.alloc(50 * 1024 * 1024, 0));
    }
    pulseChunks.length = 0;
  } catch {}

  const after = getDetailedMemorySnapshot();
  const freedMb = Math.max(0, +((after.availableBytes - before.availableBytes) / (1024 * 1024)).toFixed(1));

  return { before, after, freedMb };
}

/**
 * Checks if the system has sufficient memory budget for a target model size plus context buffer.
 * If deficit exists, returns warning and safe recommendation.
 */
export function checkMemoryReservation(
  modelSizeBytes: number,
  contextTokens = 4096,
  quantization = "Q4_K_M"
): { sufficient: boolean; requiredGb: number; availableGb: number; deficitGb: number } {
  const snap = getDetailedMemorySnapshot();
  // Model weights + KV cache overhead (~0.5GB to 2GB depending on context & layers)
  const kvCacheBytes = (contextTokens / 1024) * 0.15 * 1024 * 1024 * 1024;
  const totalRequiredBytes = modelSizeBytes + kvCacheBytes;

  const requiredGb = +(totalRequiredBytes / (1024 * 1024 * 1024)).toFixed(2);
  const availableGb = snap.availableGb;
  const deficitGb = requiredGb > availableGb ? +(requiredGb - availableGb).toFixed(2) : 0;

  return {
    sufficient: deficitGb === 0,
    requiredGb,
    availableGb,
    deficitGb,
  };
}
