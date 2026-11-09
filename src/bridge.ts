import { createInterface } from "node:readline";
import { ModelRuntimeOrchestrator } from "./runtime.js";
import { defaultCatalogService } from "./catalog.js";
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
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch (parseErr: any) {
      sendError(null, -32700, `Parse error: ${parseErr.message}`);
      return;
    }

    const { id, method, params } = msg;

    try {
      switch (method) {
        case "initialize": {
          sendResponse(id, {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "jxengine",
              version: "1.0.0",
            },
          });
          break;
        }

        case "tools/list": {
          sendResponse(id, {
            tools: [
              {
                name: "models_list",
                description: "List all discovered local GGUF and MLX models",
                inputSchema: { type: "object", properties: {} },
              },
              {
                name: "models_status",
                description: "Query currently running local models and their ports",
                inputSchema: { type: "object", properties: {} },
              },
              {
                name: "models_load",
                description: "Load an LLM into memory with automatic GPU offloading",
                inputSchema: {
                  type: "object",
                  properties: {
                    modelId: { type: "string", description: "File name or model ID to load" },
                  },
                  required: ["modelId"],
                },
              },
              {
                name: "models_unload",
                description: "Unload a running model and free system memory",
                inputSchema: {
                  type: "object",
                  properties: {
                    modelId: { type: "string", description: "Model ID or file name to unload" },
                  },
                  required: ["modelId"],
                },
              },
            ],
          });
          break;
        }

        case "tools/call": {
          const { name, arguments: toolArgs } = params || {};
          if (name === "models_list") {
            const catalog = await defaultCatalogService.getCatalog(ctx.modelDirs);
            sendResponse(id, {
              content: [{ type: "text", text: JSON.stringify(catalog.all, null, 2) }],
            });
            break;
          }
          if (name === "models_status") {
            const running = ctx.orchestrator.listRunning();
            sendResponse(id, {
              content: [{ type: "text", text: JSON.stringify({ running }, null, 2) }],
            });
            break;
          }
          if (name === "models_load") {
            const modelId = toolArgs?.modelId;
            const found = await defaultCatalogService.resolveModel(ctx.modelDirs, modelId);
            if (!found) {
              sendResponse(id, {
                isError: true,
                content: [{ type: "text", text: `Model not found: ${modelId}` }],
              });
              break;
            }
            const instance = await ctx.orchestrator.launchModel(found);
            sendResponse(id, {
              content: [{ type: "text", text: `Model ${instance.id} ready on port ${instance.port}` }],
            });
            break;
          }
          if (name === "models_unload") {
            const modelId = toolArgs?.modelId;
            const ok = await ctx.orchestrator.unloadModel(modelId);
            sendResponse(id, {
              content: [{ type: "text", text: `Model ${modelId} unloaded: ${ok}` }],
            });
            break;
          }
          sendError(id, -32601, `Unknown tool: ${name}`);
          break;
        }

        case "models/list": {
          const catalog = await defaultCatalogService.getCatalog(ctx.modelDirs);
          sendResponse(id, { models: catalog.all });
          break;
        }

        case "models/load": {
          const { modelId, port, options } = params || {};
          if (!modelId) {
            sendError(id, -32602, "Invalid params: 'modelId' is required");
            return;
          }
          const found = await defaultCatalogService.resolveModel(ctx.modelDirs, modelId);
          if (!found) {
            sendError(id, -32602, `Model not found: ${modelId}`);
            return;
          }
          const instance = await ctx.orchestrator.launchModel(found, { port, ...options });
          sendResponse(id, {
            status: "ready",
            port: instance.port,
            modelId: instance.id,
            pid: instance.process?.pid,
            backend: instance.backend,
          });
          break;
        }

        case "models/unload": {
          const { modelId } = params || {};
          if (!modelId) {
            sendError(id, -32602, "Invalid params: 'modelId' is required");
            return;
          }
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
            const found = await defaultCatalogService.resolveModel(ctx.modelDirs, manifest.activeModel.id);
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
      sendError(id, -32603, `Internal error: ${err?.message || "Execution failed"}`);
    }
  });
}

