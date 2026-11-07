import { createInterface } from "node:readline";
import { scanDirectoriesForModels } from "./gguf.js";
import { listKapitsaModels, scanMlxDirectories } from "./mlx.js";
export function startStdioBridge(ctx) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
    });
    function sendResponse(id, result) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
    }
    function sendError(id, code, message) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
    }
    rl.on("line", async (line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return;
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
                    const found = [...ggufModels, ...mlxCatalog, ...mlxCustom].find((m) => m.id === modelId || m.fileName === modelId);
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
                default:
                    sendError(id, -32601, `Method not found: ${method}`);
                    break;
            }
        }
        catch (err) {
            sendError(null, -32700, err?.message || "Parse error");
        }
    });
}
//# sourceMappingURL=bridge.js.map