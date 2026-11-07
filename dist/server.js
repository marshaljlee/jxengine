import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanDirectoriesForModels } from "./gguf.js";
import { listKapitsaModels, scanMlxDirectories } from "./mlx.js";
import { anthropicToOpenAi, openAiToAnthropic } from "./anthropic.js";
import { autoConfigureModel } from "./autoconfig.js";
import { loadSettings, addModelDirectory, removeModelDirectory } from "./config.js";
import { proxyAnthropicStream } from "./stream.js";
import { applyInstructionGuardrails } from "./guardrails.js";
import { executeWithRetry, pruneContextToFit } from "./resilience.js";
import { runPreflightDiagnostics } from "./diagnostics.js";
import { buildToolCallingGbnf } from "./grammar.js";
import { compactConversation } from "./compactor.js";
import { getDynamicStopTokens, truncateHallucinatedObservation } from "./interceptor.js";
import { isolateHistoricalScratchpads } from "./scratchpad.js";
import { SlotManager } from "./slots.js";
import { freeSystemRam, checkMemoryReservation } from "./memory.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
export class UniversalGateway {
    config;
    server;
    constructor(config) {
        this.config = config;
    }
    getModelDirs() {
        const persisted = loadSettings().modelDirs;
        return Array.from(new Set([...(this.config.modelDirs || []), ...persisted]));
    }
    start() {
        return new Promise((resolve, reject) => {
            this.server = createServer(async (req, res) => {
                // Universal CORS
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version");
                if (req.method === "OPTIONS") {
                    res.writeHead(204);
                    res.end();
                    return;
                }
                const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
                // API Endpoint: Rule 16 Preflight Diagnostics & Hardware Doctor
                if (url.pathname === "/api/doctor" && req.method === "GET") {
                    const running = this.config.orchestrator.listRunning();
                    const activeModel = running[0]?.model;
                    const diag = runPreflightDiagnostics(activeModel);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(diag));
                    return;
                }
                // API Endpoint: Free RAM safely (releases inactive caches without killing active models)
                if (url.pathname === "/api/memory/free" && req.method === "POST") {
                    const result = freeSystemRam();
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(result));
                    return;
                }
                // API Endpoint: Memory reservation preflight check
                if (url.pathname === "/api/memory/check" && req.method === "POST") {
                    try {
                        const body = await this.readJsonBody(req);
                        const modelSizeBytes = body.sizeBytes || 0;
                        const contextTokens = body.nCtx || 4096;
                        const reservation = checkMemoryReservation(modelSizeBytes, contextTokens);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify(reservation));
                        return;
                    }
                    catch (err) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: err?.message }));
                        return;
                    }
                }
                // Health check
                if (url.pathname === "/health" || url.pathname === "/api/version") {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "ok", version: "1.0.0", engine: "jxengine" }));
                    return;
                }
                // Web Configuration Panel UI
                if (url.pathname === "/" || url.pathname === "/panel") {
                    const panelPath = join(__dirname, "panel.html");
                    if (existsSync(panelPath)) {
                        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                        res.end(readFileSync(panelPath, "utf8"));
                        return;
                    }
                }
                // Manage Model Directories API
                if (url.pathname === "/api/dirs") {
                    if (req.method === "GET") {
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ dirs: this.getModelDirs() }));
                        return;
                    }
                    if (req.method === "POST") {
                        try {
                            const body = await this.readJsonBody(req);
                            let updated;
                            if (body.action === "add" && body.dir) {
                                updated = addModelDirectory(body.dir);
                            }
                            else if (body.action === "remove" && body.dir) {
                                updated = removeModelDirectory(body.dir);
                            }
                            else {
                                updated = this.getModelDirs();
                            }
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ dirs: updated }));
                            return;
                        }
                        catch (err) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ error: err?.message }));
                            return;
                        }
                    }
                }
                // Models list endpoint (OpenAI /v1/models and Ollama /api/tags)
                if (url.pathname === "/v1/models" || url.pathname === "/api/tags") {
                    const dirs = this.getModelDirs();
                    const ggufModels = await scanDirectoriesForModels(dirs);
                    const mlxCatalog = listKapitsaModels();
                    const mlxCustom = scanMlxDirectories(dirs);
                    const all = [...ggufModels, ...mlxCatalog, ...mlxCustom];
                    if (url.pathname === "/api/tags") {
                        const models = all.map((m) => ({
                            name: m.fileName,
                            model: m.id,
                            modified_at: new Date(m.modifiedAt).toISOString(),
                            size: m.sizeBytes,
                            details: { format: m.format, family: m.architecture || "transformer" }
                        }));
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ models }));
                        return;
                    }
                    const data = all.map((m) => ({
                        id: m.fileName,
                        object: "model",
                        created: Math.floor(m.modifiedAt / 1000),
                        owned_by: m.format,
                    }));
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ object: "list", data }));
                    return;
                }
                // API Endpoint: Query current running status
                if (url.pathname === "/api/status" && req.method === "GET") {
                    const running = this.config.orchestrator.listRunning();
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ running }));
                    return;
                }
                // API Endpoint: Explicit model load with custom or auto-configuration
                if (url.pathname === "/api/load" && req.method === "POST") {
                    try {
                        const body = await this.readJsonBody(req);
                        const { modelId, ...overrides } = body;
                        const dirs = this.getModelDirs();
                        const ggufModels = await scanDirectoriesForModels(dirs);
                        const mlxCatalog = listKapitsaModels();
                        const mlxCustom = scanMlxDirectories(dirs);
                        const all = [...ggufModels, ...mlxCatalog, ...mlxCustom];
                        const found = all.find((m) => m.id === modelId || m.fileName === modelId);
                        if (!found) {
                            res.writeHead(404, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ error: `Model not found: ${modelId}` }));
                            return;
                        }
                        const opts = autoConfigureModel(found, undefined, overrides);
                        // Memory reservation check: Ensure model fits available RAM before launching
                        const memCheck = checkMemoryReservation(found.sizeBytes || 0, opts.nCtx || 4096);
                        if (!memCheck.sufficient) {
                            // Attempt to free RAM first
                            freeSystemRam();
                            const recheck = checkMemoryReservation(found.sizeBytes || 0, opts.nCtx || 4096);
                            if (!recheck.sufficient && !overrides.forceLoad) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({
                                    error: `Insufficient RAM reservation. Requires ~${recheck.requiredGb} GB, but only ${recheck.availableGb} GB is currently available. Free up memory or reduce context length.`,
                                    memoryCheck: recheck,
                                }));
                                return;
                            }
                        }
                        const instance = await this.config.orchestrator.launchModel(found, opts);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ status: "ready", port: instance.port, backend: instance.backend, options: opts }));
                        return;
                    }
                    catch (err) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: err?.message }));
                        return;
                    }
                }
                // API Endpoint: Unload model
                if (url.pathname === "/api/unload" && req.method === "POST") {
                    try {
                        const body = await this.readJsonBody(req);
                        const ok = await this.config.orchestrator.unloadModel(body.modelId);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ success: ok }));
                        return;
                    }
                    catch (err) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: err?.message }));
                        return;
                    }
                }
                // Ensure active model instance
                const running = this.config.orchestrator.listRunning();
                let targetInstance = running[0];
                if (!targetInstance && this.config.defaultModelId) {
                    const dirs = this.getModelDirs();
                    const ggufModels = await scanDirectoriesForModels(dirs);
                    const mlxCatalog = listKapitsaModels();
                    const mlxCustom = scanMlxDirectories(dirs);
                    const all = [...ggufModels, ...mlxCatalog, ...mlxCustom];
                    const found = all.find((m) => m.id === this.config.defaultModelId || m.fileName === this.config.defaultModelId);
                    if (found) {
                        const opts = autoConfigureModel(found);
                        targetInstance = await this.config.orchestrator.launchModel(found, opts);
                    }
                }
                if (!targetInstance) {
                    res.writeHead(503, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "No model loaded. Visit /panel to configure and load one." }));
                    return;
                }
                // Anthropic Messages API Translator (/v1/messages)
                if (url.pathname === "/v1/messages" && req.method === "POST") {
                    try {
                        const anthropicBody = await this.readJsonBody(req);
                        const openAiPayload = anthropicToOpenAi(anthropicBody);
                        const isStreaming = Boolean(anthropicBody.stream);
                        // Feature 5: Isolate historical scratchpads
                        if (openAiPayload.messages && Array.isArray(openAiPayload.messages)) {
                            openAiPayload.messages = isolateHistoricalScratchpads(openAiPayload.messages);
                        }
                        // Feature 2: Compact middle context to prevent window overflow
                        if (openAiPayload.messages && Array.isArray(openAiPayload.messages)) {
                            const compacted = compactConversation(openAiPayload.messages, { maxContextTokens: 16384 });
                            openAiPayload.messages = compacted.messages;
                        }
                        // Feature 3: Inject dynamic stop tokens when tools exist
                        const hasTools = Boolean(anthropicBody.tools && anthropicBody.tools.length > 0);
                        openAiPayload.stop = getDynamicStopTokens(hasTools, openAiPayload.stop);
                        // Feature 1: GBNF Grammar injection if tools are present
                        if (hasTools && anthropicBody.tools) {
                            const formattedTools = anthropicBody.tools.map((t) => ({
                                type: "function",
                                function: {
                                    name: t.name,
                                    description: t.description,
                                    parameters: t.input_schema,
                                },
                            }));
                            const grammar = buildToolCallingGbnf(formattedTools);
                            if (grammar) {
                                openAiPayload.grammar = grammar;
                            }
                        }
                        // Feature 7: Bind client abort to engine slot cancellation
                        const unbindSlot = SlotManager.bindDisconnect(req, targetInstance.port);
                        // Vault Rule 3: Auto-retry with backoff on engine connection
                        const upstreamRes = await executeWithRetry(async () => {
                            return await fetch(`http://127.0.0.1:${targetInstance.port}/v1/chat/completions`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(openAiPayload),
                            });
                        });
                        if (!upstreamRes.ok) {
                            unbindSlot();
                            const errText = await upstreamRes.text();
                            res.writeHead(upstreamRes.status, { "Content-Type": "application/json" });
                            res.end(errText);
                            return;
                        }
                        if (isStreaming) {
                            await proxyAnthropicStream(upstreamRes, res, anthropicBody.model || targetInstance.model.fileName);
                            unbindSlot();
                            return;
                        }
                        const openAiJson = await upstreamRes.json();
                        // Feature 3: Non-stream hallucination truncation
                        if (openAiJson.choices?.[0]?.message?.content) {
                            const { cleanText } = truncateHallucinatedObservation(openAiJson.choices[0].message.content);
                            openAiJson.choices[0].message.content = cleanText;
                        }
                        unbindSlot();
                        const anthropicResp = openAiToAnthropic(openAiJson, anthropicBody.model || targetInstance.model.fileName);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify(anthropicResp));
                        return;
                    }
                    catch (err) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: `Anthropic translation error: ${err?.message}` }));
                        return;
                    }
                }
                // General OpenAI & Ollama Proxy (e.g. /v1/chat/completions, /v1/embeddings)
                const targetUrl = `http://127.0.0.1:${targetInstance.port}${req.url}`;
                try {
                    const bodyBuffer = [];
                    for await (const chunk of req) {
                        bodyBuffer.push(chunk);
                    }
                    const fullBody = Buffer.concat(bodyBuffer);
                    // Feature 7: Bind client abort to engine slot cancellation
                    const unbindSlot = SlotManager.bindDisconnect(req, targetInstance.port);
                    let outboundBody = fullBody;
                    if (["/v1/chat/completions", "/api/chat"].includes(url.pathname) && req.method === "POST" && fullBody.length > 0) {
                        try {
                            const parsed = JSON.parse(fullBody.toString("utf8"));
                            if (parsed.messages && Array.isArray(parsed.messages)) {
                                // Feature 5: Isolate historical scratchpads
                                parsed.messages = isolateHistoricalScratchpads(parsed.messages);
                                // Feature 2: Middle-out compaction
                                const compacted = compactConversation(parsed.messages, { maxContextTokens: 16384 });
                                parsed.messages = compacted.messages;
                                // Rule 7/42: Prune context if window limit exceeded, then apply sandwich guardrails
                                parsed.messages = pruneContextToFit(parsed.messages);
                                parsed.messages = applyInstructionGuardrails(parsed.messages);
                                // Feature 3: Dynamic Stop-Tokens when tools exist
                                const hasTools = Boolean(parsed.tools && parsed.tools.length > 0);
                                parsed.stop = getDynamicStopTokens(hasTools, parsed.stop);
                                // Feature 1: GBNF Grammar conversion if tools are supplied
                                if (hasTools && parsed.tools) {
                                    const grammar = buildToolCallingGbnf(parsed.tools);
                                    if (grammar) {
                                        parsed.grammar = grammar;
                                    }
                                }
                                outboundBody = JSON.stringify(parsed);
                            }
                        }
                        catch { }
                    }
                    // Feature 6: Local Embeddings Endpoint handling (/v1/embeddings and /api/embeddings)
                    if (["/v1/embeddings", "/api/embeddings"].includes(url.pathname) && req.method === "POST") {
                        const upstreamRes = await fetch(targetUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: typeof outboundBody === "string" ? outboundBody : new Uint8Array(outboundBody),
                        });
                        unbindSlot();
                        res.writeHead(upstreamRes.status, Object.fromEntries(upstreamRes.headers.entries()));
                        const buf = await upstreamRes.arrayBuffer();
                        res.end(Buffer.from(buf));
                        return;
                    }
                    // Vault Rule 3: Auto-retry with backoff on upstream inference calls
                    const upstreamRes = await executeWithRetry(async () => {
                        return await fetch(targetUrl, {
                            method: req.method,
                            headers: {
                                "Content-Type": req.headers["content-type"] || "application/json",
                            },
                            body: ["POST", "PUT", "PATCH"].includes(req.method || "") ? (typeof outboundBody === "string" ? outboundBody : new Uint8Array(outboundBody)) : undefined,
                        });
                    });
                    res.writeHead(upstreamRes.status, Object.fromEntries(upstreamRes.headers.entries()));
                    if (upstreamRes.body) {
                        const reader = upstreamRes.body.getReader();
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done)
                                break;
                            res.write(value);
                        }
                    }
                    unbindSlot();
                    res.end();
                }
                catch (err) {
                    res.writeHead(502, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: `Upstream error: ${err?.message}` }));
                }
            });
            this.server.listen(this.config.port, this.config.host || "127.0.0.1", () => {
                resolve(this.config.port);
            });
            this.server.on("error", reject);
        });
    }
    async readJsonBody(req) {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const str = Buffer.concat(chunks).toString("utf8");
        return str ? JSON.parse(str) : {};
    }
    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}
//# sourceMappingURL=server.js.map