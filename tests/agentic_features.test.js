import test from "node:test";
import assert from "node:assert/strict";
import { jsonSchemaToGbnf, buildToolCallingGbnf } from "../dist/grammar.js";
import { compactConversation } from "../dist/compactor.js";
import { getDynamicStopTokens, truncateHallucinatedObservation } from "../dist/interceptor.js";
import { isolateHistoricalScratchpads } from "../dist/scratchpad.js";
import { SlotManager } from "../dist/slots.js";

test("Feature 1: GBNF Grammar Generation constrains tool schemas", () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "execute_bash",
        description: "Runs bash command",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            timeout: { type: "number" },
          },
          required: ["command"],
        },
      },
    },
  ];

  const gbnf = buildToolCallingGbnf(tools);
  assert.match(gbnf, /tool_execute_bash/);
  assert.match(gbnf, /root ::= tool_execute_bash/);
  assert.match(gbnf, /string ::= "\\""/);
});

test("Feature 2: Middle-Out Conversation Compactor shrinks middle without losing head and tail", () => {
  const messages = [
    { role: "system", content: "You are an autonomous coding assistant." },
    { role: "user", content: "Read file A" },
    { role: "tool", content: "A".repeat(5000) }, // very long middle output
    { role: "assistant", content: "Reading file B next" },
    { role: "user", content: "Run test" },
  ];

  const result = compactConversation(messages, { maxContextTokens: 200, preserveTailTurns: 2 });
  assert.equal(result.compacted, true);
  assert.equal(result.messages[0].role, "system");
  assert.equal(result.messages[result.messages.length - 1].content, "Run test");
  assert.ok(result.messages[2].content.includes("[Context compacted"));
});

test("Feature 3: Tool Stop-Tokens and Hallucination Interceptor truncates simulated output", () => {
  const dynamicStops = getDynamicStopTokens(true, ["CustomStop"]);
  assert.ok(dynamicStops.includes("CustomStop"));
  assert.ok(dynamicStops.includes("</tool_call>"));
  assert.ok(dynamicStops.includes("</invoke>"));

  const rawSimulated = "<tool_call>{\"name\": \"cat\"}</tool_call>\nObservation: simulated file contents here";
  const { cleanText, truncated } = truncateHallucinatedObservation(rawSimulated);
  assert.equal(truncated, true);
  assert.equal(cleanText, "<tool_call>{\"name\": \"cat\"}</tool_call>");
});

test("Feature 4 & 5: Multi-Turn Scratchpad Isolation removes past reasoning blocks", () => {
  const history = [
    { role: "assistant", content: "<think>Let me analyze the bug.</think>I found the issue in line 10." },
    { role: "user", content: "Can you fix it?" },
    { role: "assistant", content: "<think>Now I write the fix.</think>Here is the patch." },
  ];

  const isolated = isolateHistoricalScratchpads(history, true);
  assert.equal(isolated[0].content, "I found the issue in line 10.");
  assert.ok(isolated[2].content.includes("<think>Now I write the fix.</think>"));
});

test("Feature 7: SlotManager handles slot abort call without throwing", async () => {
  // Test slot abort against mock or closed port
  const res = await SlotManager.abortSlot(99999, 0);
  assert.equal(typeof res, "boolean");
});
