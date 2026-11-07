import { createInterface } from "node:readline";
import { ModelRuntimeOrchestrator, RunningModelInstance } from "./runtime.js";
import { scanDirectoriesForModels, ModelDescriptor } from "./gguf.js";
import { listKapitsaModels, scanMlxDirectories } from "./mlx.js";
import { UpdateSurvivalManager } from "./survival.js";

export interface BridgeContext {
  modelDirs: string[];
  orchestrator: ModelRuntimeOrchestrator;
  survivalManager?: UpdateSurvivalManager;
}

export function startStdioBridge(ctx: BridgeContext) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  function sendResponse(id: any, result: any) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  function sendError(id: any, code: number, message: string) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  }

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      const { id, method, params } = msg;

      switch (method) {
        case "models/list": {
          const ggufModels = await scanDirectoriesForModels(ctx.modelDirs);
          const mlxCatalog = listKapitsaModels();
          const mlxCustom = scanMlxDirectories(ctx.modelDirs);
          const all = [...ggufModels, ...mlxCatalog, ...mlxCustom];
          sendResponse(id, { models: all });
          break;
        }

        case "models/load": {
          const { modelId, port, options } = params || {};
          const ggufModels = await scanDirectoriesForModels(ctx.modelDirs);
          const mlxCatalog = listKapitsaModels();
          const mlxCustom = scanMlxDirectories(ctx.modelDirs);
          const found = [...ggufModels, ...mlxCatalog, ...mlxCustom].find(
            (m) => m.id === modelId || m.fileName === modelId
          );
          if (!found) {
            sendError(id, -32602, `Model not found: ${modelId}`);
            return;
          }
          const instance = await ctx.orchestrator.launchModel(found, { port, ...options });
          sendResponse(id, {
            status: "ready",
            port: instance.port,
            backend: instance.backend,
            id: instance.id,
          });
          break;
        }

        case "models/unload": {
          const { modelId } = params || {};
          const ok = await ctx.orchestrator.unloadModel(modelId);
          sendResponse(id, { success: ok });
          break;
        }

        case "models/status": {
          const running = ctx.orchestrator.listRunning();
          sendResponse(id, { running });
          break;
        }

        case "lifecycle/prepareUpdate": {
          const { appName, currentVersion, gatewayPort } = params || {};
          const survival = ctx.survivalManager || new UpdateSurvivalManager();
          const running = ctx.orchestrator.listRunning();
          const target = running[0];
          const manifest = survival.prepareUpdateHandoff(
            appName || "HostApp",
            currentVersion || "1.0.0",
            target
              ? {
                  descriptor: target.model,
                  port: target.port,
                  options: {
                    nCtx: target.model.contextLength,
                  },
                }
              : undefined,
            gatewayPort || 8080,
            ctx.modelDirs
          );
          sendResponse(id, { status: "prepared", manifest });
          break;
        }

        case "lifecycle/resurrect": {
          const { newVersion } = params || {};
          const survival = ctx.survivalManager || new UpdateSurvivalManager();
          const manifest = survival.loadManifest();
          if (manifest?.activeModel) {
            const ggufModels = await scanDirectoriesForModels(ctx.modelDirs);
            const mlxCatalog = listKapitsaModels();
            const mlxCustom = scanMlxDirectories(ctx.modelDirs);
            const found = [...ggufModels, ...mlxCatalog, ...mlxCustom].find(
              (m) => m.id === manifest.activeModel?.id || m.path === manifest.activeModel?.path
            );
            if (found) {
              const instance = await ctx.orchestrator.launchModel(found, manifest.activeModel.options);
              if (newVersion) survival.acknowledgeResurrection(newVersion);
              sendResponse(id, {
                status: "resurrected",
                modelId: instance.id,
                port: instance.port,
                survivedUpdatesCount: manifest.survivedUpdatesCount,
              });
              break;
            }
          }
          sendResponse(id, { status: "no_pending_resurrection" });
          break;
        }

        default:
          sendError(id, -32601, `Method not found: ${method}`);
          break;
      }
    } catch (err: any) {
      sendError(null, -32700, err?.message || "Parse error");
    }
  });
}

