import { spawn, ChildProcess } from "node:child_process";
import { createServer, Server as NetServer } from "node:net";
import { openSync, closeSync } from "node:fs";
import { ModelDescriptor } from "./gguf.js";
import { detectKapitsaBinary } from "./mlx.js";
import { getJinjaTemplateFile } from "./templates.js";
import { saveSessionState, clearSessionState } from "./recovery.js";

export interface EngineRuntimeOptions {
  port?: number;
  nCtx?: number;
  nBatch?: number;
  nUBatch?: number;
  nGPULayers?: number;
  flashAttn?: boolean;
  threads?: number;
  keepAliveMs?: number;
  llamaServerPath?: string;
}

export interface RunningModelInstance {
  id: string;
  model: ModelDescriptor;
  port: number;
  pid: number | null;
  process?: ChildProcess;
  startedAt: number;
  lastUsedAt: number;
  backend: "llama-server" | "kapitsa";
}

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 8000;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function waitPortReady(port: number, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      try {
        const res2 = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(1000) });
        if (res2.ok) return true;
      } catch {
        // waiting
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export class ModelRuntimeOrchestrator {
  private activeInstances = new Map<string, RunningModelInstance>();

  async launchModel(
    model: ModelDescriptor,
    opts: EngineRuntimeOptions = {}
  ): Promise<RunningModelInstance> {
    const existing = this.activeInstances.get(model.id);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    const port = opts.port || (await findFreePort());

    if (model.format === "gguf") {
      return this.launchLlamaServer(model, port, opts);
    } else {
      return this.launchKapitsa(model, port, opts);
    }
  }

  private async launchLlamaServer(
    model: ModelDescriptor,
    port: number,
    opts: EngineRuntimeOptions
  ): Promise<RunningModelInstance> {
    const bin = opts.llamaServerPath || "/opt/homebrew/bin/llama-server";
    const args: string[] = [
      "-m", model.path,
      "--port", String(port),
      "--host", "127.0.0.1",
      "--jinja", // Enable automatic GGUF Jinja chat template rendering
      "-c", String(opts.nCtx || model.contextLength || 4096),
      // Vault Rule 26: KV Cache slot optimization and continuous batching
      "-np", "1", // Single dedicated high-speed slot for low latency
      "--cont-batching",
      // DRY (Don't Repeat Yourself) Sampler - Prevents infinite text repetition loops
      "--dry-multiplier", "0.8",
      "--dry-base", "1.75",
      "--dry-allowed-length", "2",
      "--dry-penalty-last-n", "-1",
    ];

    // If model lacks an embedded chat template or needs a specialized agentic tool template, supply one
    if (!model.hasChatTemplate && model.inferredTemplate) {
      const tmplFile = getJinjaTemplateFile(model.inferredTemplate);
      args.push("--chat-template-file", tmplFile);
    }

    if (opts.flashAttn !== false) args.push("-fa");
    if (opts.nGPULayers !== undefined) args.push("-ngl", String(opts.nGPULayers));
    else args.push("-ngl", "99"); // default offload all to Metal on Mac
    if (opts.nBatch) args.push("-b", String(opts.nBatch));
    if (opts.nUBatch) args.push("-ub", String(opts.nUBatch));
    if (model.projector) args.push("--mmproj", model.projector);

    const child = spawn(bin, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    const ready = await waitPortReady(port, 45000);
    if (!ready) {
      try {
        if (child.pid) process.kill(child.pid);
      } catch {}
      throw new Error(`llama-server failed to bind port ${port} within timeout`);
    }

    const instance: RunningModelInstance = {
      id: model.id,
      model,
      port,
      pid: child.pid || null,
      process: child,
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
      backend: "llama-server",
    };

    this.activeInstances.set(model.id, instance);
    saveSessionState({
      activeModelId: model.id,
      activeModelPath: model.path,
      activePort: port,
      nCtx: opts.nCtx || model.contextLength || 4096,
      nGPULayers: opts.nGPULayers,
    });
    return instance;
  }

  private async launchKapitsa(
    model: ModelDescriptor,
    port: number,
    opts: EngineRuntimeOptions
  ): Promise<RunningModelInstance> {
    const bin = detectKapitsaBinary();
    if (!bin) {
      throw new Error("Kapitsa engine not found on system");
    }

    const modelName = model.path.replace("kapitsa://", "");
    const args = [
      "serve",
      "--model", modelName,
      "--port", String(port),
      "--host", "127.0.0.1",
    ];

    const child = spawn(bin, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    const ready = await waitPortReady(port, 45000);
    if (!ready) {
      try {
        if (child.pid) process.kill(child.pid);
      } catch {}
      throw new Error(`Kapitsa server failed to bind port ${port} within timeout`);
    }

    const instance: RunningModelInstance = {
      id: model.id,
      model,
      port,
      pid: child.pid || null,
      process: child,
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
      backend: "kapitsa",
    };

    this.activeInstances.set(model.id, instance);
    saveSessionState({
      activeModelId: model.id,
      activeModelPath: model.path,
      activePort: port,
      nCtx: opts.nCtx || model.contextLength || 4096,
      nGPULayers: opts.nGPULayers,
    });
    return instance;
  }

  async unloadModel(id: string): Promise<boolean> {
    const inst = this.activeInstances.get(id);
    if (!inst) return false;

    if (inst.pid) {
      try {
        // Kill the detached process group first to prevent orphaned worker ports
        process.kill(-inst.pid, "SIGTERM");
      } catch {
        try {
          process.kill(inst.pid, "SIGTERM");
        } catch {}
      }
    }
    this.activeInstances.delete(id);
    clearSessionState();
    return true;
  }

  listRunning(): RunningModelInstance[] {
    return Array.from(this.activeInstances.values());
  }
}

