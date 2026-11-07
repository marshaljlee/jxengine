import test from "node:test";
import assert from "node:assert/strict";
import { repairAndParseJson, sanitizeToolArguments } from "../dist/repair.js";
import { extractTextualToolCalls } from "../dist/tools.js";
import { openAiToAnthropic } from "../dist/anthropic.js";
import { SlotManager } from "../dist/slots.js";

test("JSON Repair: fixes unquoted keys and truncated strings", () => {
  const malformed = '{ command: "git status", branch: "main';
  const res = repairAndParseJson(malformed);
  assert.equal(res.success, true);
  assert.equal(res.data.command, "git status");
  assert.equal(res.data.branch, "main");
});

test("JSON Repair: strips markdown code fences before repairing", () => {
  const fenced = '```json\n{"action": "test", "num": 42,}\n```';
  const res = repairAndParseJson(fenced);
  assert.equal(res.success, true);
  assert.equal(res.data.action, "test");
  assert.equal(res.data.num, 42);
});

test("Tool Interceptor: repairs malformed JSON in Qwen and Hermes dialect tags", () => {
  const qwenMalformed = '<tool_call>{"name": "fetch_api", "arguments": { url: "https://example.com", timeout: 5000,}}</tool_call>';
  const parsed = extractTextualToolCalls(qwenMalformed);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].name, "fetch_api");
  assert.equal(parsed.calls[0].arguments.url, "https://example.com");
});

test("Anthropic Translator: ensures all tool_use IDs start with toolu_ prefix", () => {
  const openAiMock = {
    choices: [
      {
        message: {
          role: "assistant",
          tool_calls: [
            {
              id: "call_abc123",
              function: {
                name: "run_bash",
                arguments: '{"command": "ls -la"}',
              },
            },
          ],
        },
      },
    ],
  };

  const anthropic = openAiToAnthropic(openAiMock, "test-model");
  const block = anthropic.content.find((b) => b.type === "tool_use");
  assert.ok(block);
  assert.ok(block.id.startsWith("toolu_"));
  assert.equal(block.id, "toolu_call_abc123");
});

test("SlotManager abortAllActiveSlots handles non-responsive port gracefully", async () => {
  const count = await SlotManager.abortAllActiveSlots(99998);
  assert.equal(count, 1);
});
