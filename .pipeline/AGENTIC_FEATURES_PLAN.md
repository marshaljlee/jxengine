# Execution Plan: 7 Apex Agentic LLM Capabilities

## Objectives
Implement the 7 agentic runtime features into `jxengine` to make local models operate as fully autonomous coding/task agents with zero dropouts, zero hallucinated tool output, zero context crashes, and zero orphaned slot memory.

### Feature Matrix & Modules:
1. **Grammar-Constrained Decoding (GBNF Converter)**:
   - Module: `src/grammar.ts`
   - Purpose: Convert JSON tool schema arrays or `response_format` schemas into GBNF (GGML BNF) grammar strings, and inject `grammar` parameter into `/v1/chat/completions` request.
2. **Context Auto-Compaction & Slot Shift**:
   - Updates: `src/runtime.ts` (`--context-shift` flag for `llama-server`), `src/compactor.ts` (middle-out semantic compaction algorithm).
3. **Tool Result Hallucination Interceptor & Dynamic Stop Tokens**:
   - Module: `src/interceptor.ts` & updates to `src/stream.ts` / `src/server.ts`
   - Purpose: Inject dynamic stop tokens (`</tool_call>`, `</invoke>`, `</function>`, `<|im_end|>`) when tools are present; immediately cut off any post-call stream emission if model attempts to simulate environment output.
4. **Speculative Decoding Engine Pairing**:
   - Updates: `src/runtime.ts`, `src/autoconfig.ts`, `src/panel.html`
   - Purpose: Support `--model-draft` pairing (`-md`) in `llama-server` for 2-3x token generation speedup.
5. **Multi-Turn Scratchpad Isolation**:
   - Module: `src/scratchpad.ts`
   - Purpose: Strip `<think>` / reasoning scratchpads from prior turns before forwarding context to model, preventing self-prompt confusion.
6. **Local Embeddings Endpoint (`/v1/embeddings` & `/api/embeddings`)**:
   - Updates: `src/server.ts`, `src/runtime.ts` (`--embedding` flag or standalone embedding proxy).
7. **Real-Time KV Slot & Client Disconnect Cancellation**:
   - Module: `src/slots.ts` & updates in `src/server.ts`
   - Purpose: Listen for `req.on("close")` and issue `POST /slots/{id}?action=abort` to free GPU/CPU instantly on client cancellation.

## Verification
- Add comprehensive automated unit/integration tests in `tests/agentic_features.test.js`.
- Run full test suite (`npm test`).
