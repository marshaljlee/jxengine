import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ModelRuntimeOrchestrator, RunningModelInstance } from "./runtime.js";
import { defaultCatalogService } from "./catalog.js";
import {
  formatApiError,
  ModelNotFoundError,
  InsufficientMemoryError,
  NoActiveModelError,
  InvalidRequestError,
} from "./errors.js";
import { anthropicToOpenAi, openAiToAnthropic, AnthropicRequest } from "./anthropic.js";
import { autoConfigureModel } from "./autoconfig.js";
import { loadSettings, addModelDirectory, removeModelDirectory } from "./config.js";
import { proxyAnthropicStream } from "./stream.js";
import { applyInstructionGuardrails } from "./guardrails.js";
import { executeWithRetry, pruneContextToFit } from "./resilience.js";
import { loadSessionState } from "./recovery.js";
import { runPreflightDiagnostics } from "./diagnostics.js";
import { buildToolCallingGbnf, jsonSchemaToGbnf } from "./grammar.js";
import { compactConversation } from "./compactor.js";
import { getDynamicStopTokens, truncateHallucinatedObservation } from "./interceptor.js";
import { isolateHistoricalScratchpads } from "./scratchpad.js";
import { SlotManager } from "./slots.js";
import { getDetailedMemorySnapshot, freeSystemRam, checkMemoryReservation } from "./memory.js";
import { BillionContextEngine, ACP_TOOLS_SCHEMA } from "./billion.js";
import { injectAmbientContext, executeNativeSystemTool, SYSTEM_TOOLS_SCHEMA } from "./ambient.js";
import { recordHistoryTurns, loadHistorySession, exportHistoryFormatted } from "./history.js";

import { UpdateSurvivalManager } from "./survival.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface GatewayConfig {
  port: number;
  host?: string;
  modelDirs?: string[];
  orchestrator: ModelRuntimeOrchestrator;
  defaultModelId?: string;
  survivalManager?: UpdateSurvivalManager;
}

export class UniversalGateway {
  private server?: ReturnType<typeof createServer>;
  private billionContext = new BillionContextEngine();
  private survival: UpdateSurvivalManager;

  constructor(private config: GatewayConfig) {
    this.survival = config.survivalManager || new UpdateSurvivalManager();
  }

  private getModelDirs(): string[] {
    const persisted = loadSettings().modelDirs;
    return Array.from(new Set([...(this.config.modelDirs || []), ...persisted]));
  }

  private async resolveTargetInstance(requestedModelId?: string): Promise<RunningModelInstance | null> {
    const running = this.config.orchestrator.listRunning();
    if (requestedModelId) {
      const match = running.find(
        (r) => r.id === requestedModelId || r.model.fileName === requestedModelId || r.model.id === requestedModelId
      );
      if (match) return match;

      // Model requested is not currently running: Attempt hot-spin if model exists
      const dirs = this.getModelDirs();
      const found = await defaultCatalogService.resolveModel(dirs, requestedModelId);
      if (found) {
        const opts = autoConfigureModel(found);
        return await this.config.orchestrator.launchModel(found, opts);
      }
    }

    // Default to first running instance or default configured model
    if (running.length > 0) return running[0];

    if (this.config.defaultModelId) {
      const dirs = this.getModelDirs();
      const found = await defaultCatalogService.resolveModel(dirs, this.config.defaultModelId);
      if (found) {
        const opts = autoConfigureModel(found);
        return await this.config.orchestrator.launchModel(found, opts);
      }
    }

    return null;
  }

  start(): Promise<number> {
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

        // API Endpoint: Serve JXEngine App Icon
        if (url.pathname === "/api/icon" || url.pathname === "/favicon.ico") {
          const iconPath = join(__dirname, "..", "icon.png");
          if (existsSync(iconPath)) {
            const buf = readFileSync(iconPath);
            res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
            res.end(buf);
            return;
          }
        }

        // API Endpoint: History query & export
        if (url.pathname === "/api/history") {
          const sessionId = url.searchParams.get("sessionId") || "default";
          const format = url.searchParams.get("format") === "txt" ? "txt" : "json";
          if (req.method === "GET") {
            const data = exportHistoryFormatted(sessionId, format);
            res.writeHead(200, { "Content-Type": format === "json" ? "application/json" : "text/plain; charset=utf-8" });
            res.end(data);
            return;
          }
        }

        // API Endpoint: Execute native OS desktop tool
        if (url.pathname === "/api/tools/execute" && req.method === "POST") {
          try {
            const body = await this.readJsonBody(req);
            const result = await executeNativeSystemTool(body.name, body.arguments || {});
            if (result) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
              return;
            }
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Tool ${body.name} not found or unsupported` }));
            return;
          } catch (err: any) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err?.message }));
            return;
          }
        }

        // API Endpoint: Billion-Context ACP status
        if (url.pathname === "/api/billion/status" && req.method === "GET") {
          const session = this.billionContext.getOrCreateSession("default");
          const status = this.billionContext.getStatus(session);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(status));
          return;
        }

        // API Endpoint: Billion-Context search
        if (url.pathname === "/api/billion/search" && req.method === "POST") {
          try {
            const body = await this.readJsonBody(req);
            const session = this.billionContext.getOrCreateSession(body.sessionId || "default");
            const hits = this.billionContext.searchContext(session, body.query || "");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ query: body.query, hits }));
            return;
          } catch (err: any) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err?.message }));
            return;
          }
        }

        // API Endpoint: Lifecycle & Update Survival Handoff
        if (url.pathname === "/api/lifecycle/handoff" && req.method === "POST") {
          try {
            const body = await this.readJsonBody(req);
            const running = this.config.orchestrator.listRunning();
            const target = running[0];
            const manifest = this.survival.prepareUpdateHandoff(
              body.appName || "HostApp",
              body.currentVersion || "1.0.0",
              target
                ? {
                    descriptor: target.model,
                    port: target.port,
                    options: {
                      nCtx: target.model.contextLength,
                    },
                  }
                : undefined,
              this.config.port,
              this.getModelDirs()
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "handoff_ready", manifest }));
            return;
          } catch (err: any) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err?.message }));
            return;
          }
        }

        // API Endpoint: Lifecycle & Post-Update Resurrection
        if (url.pathname === "/api/lifecycle/resurrect" && req.method === "POST") {
          try {
            const body = await this.readJsonBody(req);
            const manifest = this.survival.loadManifest();
            if (manifest?.activeModel) {
              const dirs = this.getModelDirs();
              const found = await defaultCatalogService.resolveModel(dirs, manifest.activeModel.id);
              if (found) {
                const instance = await this.config.orchestrator.launchModel(found, manifest.activeModel.options);
                if (body.newVersion) this.survival.acknowledgeResurrection(body.newVersion);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                  status: "resurrected",
                  modelId: instance.id,
                  port: instance.port,
                  survivedUpdatesCount: manifest.survivedUpdatesCount,
                }));
                return;
              }
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "no_pending_resurrection" }));
            return;
          } catch (err: any) {
            const { statusCode, payload } = formatApiError(err);
            res.writeHead(statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
            return;
          }
        }

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
          } catch (err: any) {
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

        // Browse / Pick Directory Dialog API (macOS native file picker)
        if (url.pathname === "/api/dirs/pick" && req.method === "POST") {
          try {
            if (process.platform === "darwin") {
              const execAsync = promisify(exec);
              const script = 'osascript -e \'set chosenFolder to POSIX path of (choose folder with prompt "Select Model Folder")\' -e \'return chosenFolder\'';
              const { stdout } = await execAsync(script);
              const selectedPath = stdout.trim().replace(/\/$/, "");
              if (selectedPath) {
                const updated = addModelDirectory(selectedPath);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ path: selectedPath, dirs: updated }));
                return;
              }
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ path: null, dirs: this.getModelDirs() }));
            return;
          } catch (err: any) {
            // User cancelled folder picker
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ path: null, cancelled: true, dirs: this.getModelDirs() }));
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
              let updated: string[];
              if (body.action === "add" && body.dir) {
                updated = addModelDirectory(body.dir);
              } else if (body.action === "remove" && body.dir) {
                updated = removeModelDirectory(body.dir);
              } else {
                updated = this.getModelDirs();
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ dirs: updated }));
              return;
            } catch (err: any) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err?.message }));
              return;
            }
          }
        }

        // Models list endpoint (OpenAI /v1/models and Ollama /api/tags)
        if (url.pathname === "/v1/models" || url.pathname === "/api/tags") {
          const dirs = this.getModelDirs();
          const catalog = await defaultCatalogService.getCatalog(dirs);
          const all = catalog.all;

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
            const found = await defaultCatalogService.resolveModel(dirs, modelId);
            if (!found) {
              throw new ModelNotFoundError(modelId);
            }
            const opts = autoConfigureModel(found, undefined, overrides);

            // Memory reservation check: Ensure model fits available RAM before launching
            const memCheck = checkMemoryReservation(found.sizeBytes || 0, opts.nCtx || 4096);
            if (!memCheck.sufficient) {
              // Attempt to free RAM first
              freeSystemRam();
              const recheck = checkMemoryReservation(found.sizeBytes || 0, opts.nCtx || 4096);
              if (!recheck.sufficient && !overrides.forceLoad) {
                throw new InsufficientMemoryError(recheck.requiredGb, recheck.availableGb);
              }
            }

            const instance = await this.config.orchestrator.launchModel(found, opts);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ready", port: instance.port, backend: instance.backend, options: opts }));
            return;
          } catch (err: any) {
            const { statusCode, payload } = formatApiError(err);
            res.writeHead(statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
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
          } catch (err: any) {
            const { statusCode, payload } = formatApiError(err);
            res.writeHead(statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
            return;
          }
        }

        // Anthropic Messages API Translator (/v1/messages)
        if (url.pathname === "/v1/messages" && req.method === "POST") {
          try {
            const anthropicBody: AnthropicRequest = await this.readJsonBody(req);
            const targetInstance = await this.resolveTargetInstance(anthropicBody.model);
            if (!targetInstance) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Model not available or loaded: ${anthropicBody.model || "default"}` }));
              return;
            }

            const openAiPayload: any = anthropicToOpenAi(anthropicBody);
            const isStreaming = Boolean(anthropicBody.stream);

            // Pattern 2: Native OS Context Injection (X-OS-Context or X-Context header)
            const osContext = (req.headers["x-os-context"] || req.headers["x-context"]) as string | undefined;
            if (osContext && openAiPayload.messages) {
              openAiPayload.messages = injectAmbientContext(openAiPayload.messages, osContext);
            }

            // Billion-Context Feature & Pattern 3 System Tools
            const acpSession = this.billionContext.getOrCreateSession(anthropicBody.model || "default");
            if (openAiPayload.messages && Array.isArray(openAiPayload.messages)) {
              openAiPayload.messages = this.billionContext.tagMessages(openAiPayload.messages);
              acpSession.messages = openAiPayload.messages;
            }

            const baseTools = anthropicBody.tools || [];
            const mergedTools = [
              ...baseTools,
              ...ACP_TOOLS_SCHEMA.map(t => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters,
              })),
              ...SYSTEM_TOOLS_SCHEMA.map(t => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters,
              })),
            ];

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
            const hasTools = mergedTools.length > 0;
            openAiPayload.stop = getDynamicStopTokens(hasTools, openAiPayload.stop);

            // Feature 1: GBNF Grammar injection if tools are present
            if (hasTools) {
              const formattedTools = mergedTools.map((t: any) => ({
                type: "function" as const,
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

            const openAiJson: any = await upstreamRes.json();
            // Feature 3: Non-stream hallucination truncation
            if (openAiJson.choices?.[0]?.message?.content) {
              const { cleanText } = truncateHallucinatedObservation(openAiJson.choices[0].message.content);
              openAiJson.choices[0].message.content = cleanText;
            }

            unbindSlot();
            const anthropicResp = openAiToAnthropic(openAiJson as any, anthropicBody.model || targetInstance.model.fileName);

            // Pattern 4: Record history turn for conversation export
            if (openAiPayload.messages) {
              const lastUser = openAiPayload.messages.filter((m: any) => m.role === "user").pop();
              if (lastUser) {
                recordHistoryTurns(anthropicBody.model || "default", [
                  { role: "user", content: lastUser.content },
                  { role: "assistant", content: JSON.stringify(anthropicResp.content), model: anthropicBody.model },
                ]);
              }
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(anthropicResp));
            return;
          } catch (err: any) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Anthropic translation error: ${err?.message}` }));
            return;
          }
        }

        // General OpenAI & Ollama Proxy (e.g. /v1/chat/completions, /v1/embeddings)
        try {
          const bodyBuffer: Buffer[] = [];
          for await (const chunk of req) {
            bodyBuffer.push(chunk);
          }
          const fullBody = Buffer.concat(bodyBuffer);

          let requestedModel: string | undefined = undefined;
          let parsedPayload: any = null;
          if (fullBody.length > 0) {
            try {
              parsedPayload = JSON.parse(fullBody.toString("utf8"));
              requestedModel = parsedPayload.model;
            } catch {}
          }

          const targetInstance = await this.resolveTargetInstance(requestedModel);
          if (!targetInstance) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `No model available or loaded for: ${requestedModel || "default"}` }));
            return;
          }

          const targetUrl = `http://127.0.0.1:${targetInstance.port}${req.url}`;
          const unbindSlot = SlotManager.bindDisconnect(req, targetInstance.port);

          let outboundBody: Buffer | string = fullBody;
          if (["/v1/chat/completions", "/api/chat"].includes(url.pathname) && req.method === "POST" && parsedPayload) {
            try {
              const parsed = parsedPayload;
              if (parsed.messages && Array.isArray(parsed.messages)) {
                // Pattern 2: Native OS Context Injection (X-OS-Context header or parsed.context)
                const osContext = ((req.headers["x-os-context"] || req.headers["x-context"]) as string) || parsed.context;
                if (osContext) {
                  parsed.messages = injectAmbientContext(parsed.messages, osContext);
                }

                // Billion-Context Feature: Tag messages with <acp:m0000X> sequence IDs
                const acpSession = this.billionContext.getOrCreateSession(parsed.model || "default");
                parsed.messages = this.billionContext.tagMessages(parsed.messages);
                acpSession.messages = parsed.messages;

                // Billion-Context Feature & Pattern 3 System Tools
                const baseTools = parsed.tools || [];
                const mergedTools = [...baseTools, ...ACP_TOOLS_SCHEMA, ...SYSTEM_TOOLS_SCHEMA];
                parsed.tools = mergedTools;

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

                // GBNF Grammar conversion: Only if grammar is explicitly requested or when not passing native tools (llama-server rejects grammar with tools)
                if (hasTools && parsed.tools && !parsed.tools) {
                  const grammar = buildToolCallingGbnf(parsed.tools);
                  if (grammar) {
                    parsed.grammar = grammar;
                  }
                }

                outboundBody = JSON.stringify(parsed);
              }
            } catch {}
          }

          // Feature 6: Local Embeddings Endpoint handling (/v1/embeddings and /api/embeddings)
          if (["/v1/embeddings", "/api/embeddings"].includes(url.pathname) && req.method === "POST") {
            try {
              if (parsedPayload && Array.isArray(parsedPayload.input) && parsedPayload.input.length > 32) {
                // Batch-chunking iterator: Prevents upstream batch overflow on large arrays
                const chunkSize = 16;
                const chunks: string[][] = [];
                for (let i = 0; i < parsedPayload.input.length; i += chunkSize) {
                  chunks.push(parsedPayload.input.slice(i, i + chunkSize));
                }

                const aggregatedData: any[] = [];
                let totalPromptTokens = 0;

                for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
                  const subPayload = { ...parsedPayload, input: chunks[cIdx] };
                  const subRes = await fetch(targetUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(subPayload),
                  });
                  if (!subRes.ok) {
                    throw new Error(`Upstream embedding chunk failed with status ${subRes.status}`);
                  }
                  const subJson: any = await subRes.json();
                  if (subJson.data && Array.isArray(subJson.data)) {
                    subJson.data.forEach((item: any, itemIdx: number) => {
                      aggregatedData.push({
                        ...item,
                        index: cIdx * chunkSize + itemIdx,
                      });
                    });
                  }
                  if (subJson.usage?.prompt_tokens) {
                    totalPromptTokens += subJson.usage.prompt_tokens;
                  }
                }

                unbindSlot();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                  object: "list",
                  data: aggregatedData,
                  model: parsedPayload.model || targetInstance.model.fileName,
                  usage: { prompt_tokens: totalPromptTokens, total_tokens: totalPromptTokens },
                }));
                return;
              }
            } catch {}

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
              if (done) break;
              res.write(value);
            }
          }
          unbindSlot();
          res.end();
        } catch (err: any) {
          const { statusCode, payload } = formatApiError(err);
          res.writeHead(statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        }
      });

      this.server.listen(this.config.port, this.config.host || "127.0.0.1", () => {
        resolve(this.config.port);
      });
      this.server.on("error", reject);
    });
  }

  private async readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalLength = 0;
      const MAX_PAYLOAD_BYTES = 50 * 1024 * 1024; // 50MB protection

      const onData = (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > MAX_PAYLOAD_BYTES) {
          cleanup();
          reject(new InvalidRequestError("Request payload exceeds 50MB limit"));
          return;
        }
        chunks.push(chunk);
      };

      const onEnd = () => {
        cleanup();
        try {
          const str = Buffer.concat(chunks).toString("utf8");
          resolve(str.trim() ? JSON.parse(str) : {});
        } catch (err: any) {
          reject(new InvalidRequestError(`Malformed JSON payload: ${err?.message}`));
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(new InvalidRequestError(`Client request stream error: ${err.message}`));
      };

      const onClose = () => {
        if (!req.complete) {
          cleanup();
          reject(new InvalidRequestError("Client connection closed before request completed"));
        }
      };

      const cleanup = () => {
        req.off("data", onData);
        req.off("end", onEnd);
        req.off("error", onError);
        req.off("close", onClose);
      };

      req.on("data", onData);
      req.on("end", onEnd);
      req.on("error", onError);
      req.on("close", onClose);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}
