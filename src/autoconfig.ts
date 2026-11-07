import { execSync } from "node:child_process";
import { ModelDescriptor } from "./gguf.js";
import { EngineRuntimeOptions } from "./runtime.js";

export interface SystemHardwareProfile {
  totalMemoryBytes: number;
  totalMemoryGb: number;
  cpuCores: number;
  isAppleSilicon: boolean;
}

export function detectSystemHardware(): SystemHardwareProfile {
  let memBytes = 16 * 1024 * 1024 * 1024;
  let cores = 8;
  let isArm = process.arch === "arm64";

  try {
    const memStr = execSync("sysctl -n hw.memsize 2>/dev/null", { encoding: "utf8" }).trim();
    if (memStr) memBytes = parseInt(memStr, 10);
  } catch {}

  try {
    const cpuStr = execSync("sysctl -n hw.ncpu 2>/dev/null", { encoding: "utf8" }).trim();
    if (cpuStr) cores = parseInt(cpuStr, 10);
  } catch {}

  return {
    totalMemoryBytes: memBytes,
    totalMemoryGb: Math.round(memBytes / (1024 * 1024 * 1024)),
    cpuCores: cores,
    isAppleSilicon: isArm,
  };
}

export function autoConfigureModel(
  model: ModelDescriptor,
  hw: SystemHardwareProfile = detectSystemHardware(),
  userOverrides: Partial<EngineRuntimeOptions> = {}
): EngineRuntimeOptions {
  const modelBytes = model.sizeBytes || 8 * 1024 * 1024 * 1024;
  const availableBudgetGb = hw.totalMemoryGb * 0.75; // Leave 25% for OS and apps
  const modelGb = modelBytes / (1024 * 1024 * 1024);

  // Default optimal context size
  let optimalCtx = model.contextLength || 4096;
  if (optimalCtx > 32768) {
    optimalCtx = 32768; // Cap default unbounded contexts for safe memory
  }
  if (modelGb > availableBudgetGb * 0.8) {
    // If model occupies most of RAM, reduce context to avoid swap
    optimalCtx = Math.min(optimalCtx, 4096);
  }

  // GPU Layers: On Apple Silicon, 99 offloads all layers to unified Metal memory
  const nGPULayers = hw.isAppleSilicon ? 99 : 33;

  // Batch sizes tuned for Apple Silicon unified bandwidth
  const nBatch = hw.totalMemoryGb >= 32 ? 2048 : 1024;
  const nUBatch = 512;

  // CPU Threads: physical performance cores
  const threads = Math.max(1, Math.min(hw.cpuCores - 2, 8));

  return {
    nCtx: userOverrides.nCtx || optimalCtx,
    nGPULayers: userOverrides.nGPULayers !== undefined ? userOverrides.nGPULayers : nGPULayers,
    nBatch: userOverrides.nBatch || nBatch,
    nUBatch: userOverrides.nUBatch || nUBatch,
    threads: userOverrides.threads || threads,
    flashAttn: userOverrides.flashAttn !== undefined ? userOverrides.flashAttn : true,
    ...userOverrides,
  };
}

