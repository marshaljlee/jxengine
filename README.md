# JXEngine

Universal, modular local LLM inference gateway and orchestrator built for Apple Silicon and modern desktop environments. Runs both GGUF (via `llama-server`) and MLX models (via `kapitsa`), embeddable into host applications via stdio JSON-RPC or usable standalone via high-speed OpenAI, Anthropic Messages, and Ollama APIs.

---

## Features

- **Dual-Engine Orchestrator**: Seamlessly manages resident `llama-server` and `kapitsa` processes with automated health checks, port allocation, and process-group SIGTERM cleanup.
- **Hardware Autotuning**: Automatically calculates optimal context windows, Metal GPU layer offloading, prompt batching, micro-batching, and thread counts using host hardware profile.
- **Multi-Protocol Gateway**:
  - OpenAI-compatible (`/v1/chat/completions`, `/v1/models`)
  - Anthropic Messages API (`/v1/messages` with native streaming SSE translation)
  - Ollama API (`/api/tags`, `/api/chat`)
  - Embeddings (`/v1/embeddings`, `/api/embeddings`) with automatic batch-chunking
- **Agentic AI Interoperability**:
  - GBNF Grammar Generation (`jsonSchemaToGbnf`, `buildToolCallingGbnf`) for schema-constrained token decoding.
  - Multi-dialect tool calling interceptor (Qwen `<tool_call>`, Hermes `<invoke>`, `<function>`, and `<|python_tag|>`).
  - AST-level JSON repair (`jsonrepair`) for malformed arguments.
  - Anthropic `toolu_` ID normalization.
  - Dynamic stop tokens and hallucination interception.
  - Multi-turn scratchpad isolation (strips historical `<think>` tokens).
- **Billion-Context Active Context Pruning (ACP)**:
  - LSM-Tree multi-generational context compression architecture based on `ranxianglei/billion-context`.
  - Injects cooperative tools (`compress`, `decompress`, `search_context`, `acp_status`, `acp_rule`) and addressable sequence tags (`<!-- <acp:m0000X> -->`).
- **Memory Safety & Diagnostics**:
  - Live macOS Virtual Memory table inspection (`vm_stat`).
  - Preflight memory reservation check to prevent kernel OOM panics.
  - Non-disruptive RAM reclamation button.
  - Real-time client disconnect cancellation (`SlotManager.abortAllActiveSlots()`).
- **Web Management Panel**:
  - 1400px fluid desktop workstation interface with live memory allocation gauges, directory search manager, engine toggles, and copyable endpoint chips.

---

## Quick Start

### Installation

```bash
git clone https://github.com/marshaljlee/jxengine.git
cd jxengine
npm install
npm run build
```

---

## Invariant Integration & Installation Mandate (Rule 067)

`jxengine` is designed as a foundational engine module. When building or integrating `jxengine` into a host application, wrapper, or plugin:

1. **Exact Repo Identity:** `jxengine` must be installed exactly as it is in the repository folder, nothing more and nothing less. All source files, test suites, design tokens, documentation, icons, and configuration files must be retained.
2. **Dedicated Settings Tab:** When an app integrates or installs `jxengine`, it must set `jxengine` into a dedicated settings tab of its own. The tab embeds `jxengine`'s management panel directly (supporting `?tab=1` and iframe/webview messaging), giving the user direct access to local model discovery, memory controls, and API endpoints inside host app preferences.
3. **Pipeliner Protocol Enforcement:** Automated integrations must execute via the canonical Pipeliner state machine (`250 - JXEngine Exact Zero-Deviation Module Installation & Customization Pipeline v1.0.md`).
4. **Sequential Quality Gate:** All 39 unit tests (`npm test`) must pass on the initial baseline before any downstream customization, host routing, or theme overrides are permitted. Customization is unlocked only after bit-for-bit baseline verification.

### Run Tests

```bash
npm test
```

### Start the Gateway

```bash
# Start standalone server on default port 8080
npm start

# Or using the CLI binary
node bin/jxengine.js serve --port 8080
```

Open `http://localhost:8080` in your browser to view the workstation dashboard and manage your local models.

---

## Architecture

```
src/
├── anthropic.ts     # Anthropic Messages API bidirectional translator
├── autoconfig.ts    # Hardware parameter autotuner (Metal GPU & CPU)
├── billion.ts       # Billion-Context ACP engine (LSM-Tree compaction)
├── bridge.ts        # Stdio JSON-RPC 2.0 bridge for desktop app embedding
├── cli.ts           # Standalone CLI commands (serve, list, doctor)
├── compactor.ts     # Middle-out conversation compactor
├── config.ts        # Persistent configuration store (~/.jxengine/settings.json)
├── diagnostics.ts   # Hardware preflight doctor & diagnostics report
├── gguf.ts          # Zero-dependency binary GGUF header parser
├── grammar.ts       # GBNF grammar generator for JSON schema & tools
├── guardrails.ts    # Sandwich re-anchoring and repetition loop detector
├── humanizer.ts     # Non-invasive conversational tone cleaner
├── hygiene.ts       # Control token sanitizer & thinking block isolator
├── interceptor.ts   # Dynamic stop-tokens & hallucination interceptor
├── memory.ts        # macOS memory snapshot, cache purge, & reservation check
├── mlx.ts           # Kapitsa binary & Apple Silicon MLX directory scanner
├── panel.html       # Fluid desktop control panel UI
├── recovery.ts      # Session persistence (~/.jxengine/session.json)
├── repair.ts        # Resilient JSON repair utility for tool arguments
├── resilience.ts    # Exponential backoff retry & payload validators
├── runtime.ts       # Resident process orchestrator (llama-server & kapitsa)
├── scratchpad.ts    # Multi-turn thinking tag isolation
├── server.ts        # Universal HTTP Gateway & dynamic multi-model router
├── slots.ts         # Real-time slot query & disconnect cancellation
├── stream.ts        # Full Anthropic SSE stream proxy
├── templates.ts     # Embedded Jinja chat templates for agentic models
├── tools.ts         # Multi-dialect textual tool calling parser
└── vision.ts        # Multimodal image input normalizer
```

---

## License

MIT License.
