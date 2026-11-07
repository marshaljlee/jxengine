import test from "node:test";
import assert from "node:assert/strict";
import { resolveLlamaServerBinary } from "../dist/discovery.js";
import { injectAmbientContext, executeNativeSystemTool, SYSTEM_TOOLS_SCHEMA } from "../dist/ambient.js";
import { recordHistoryTurns, loadHistorySession, exportHistoryFormatted } from "../dist/history.js";

test("Feature 1: Binary Discovery resolves candidate paths or system fallback", () => {
  const bin = resolveLlamaServerBinary();
  assert.ok(typeof bin === "string" && bin.length > 0);
  assert.ok(bin.includes("llama-server"));
});

test("Feature 2: Ambient OS Context Injection injects active app/context cleanly into user turn", () => {
  const messages = [
    { role: "system", content: "You are a desktop assistant." },
    { role: "user", content: "Summarize this bug." },
  ];
  const injected = injectAmbientContext(messages, "Xcode - AppDelegate.swift:42 (Fatal Error)");
  assert.equal(injected.length, 2);
  assert.ok(injected[1].content.includes("[Active OS Context: Xcode - AppDelegate.swift:42 (Fatal Error)]"));
  assert.ok(injected[1].content.includes("Summarize this bug."));
});

test("Feature 3: System Tools Schema contains frontmost app, open url, and weather", () => {
  const names = SYSTEM_TOOLS_SCHEMA.map((t) => t.function.name);
  assert.deepEqual(names, ["get_frontmost_app", "open_url", "get_weather"]);
});

test("Feature 3: executeNativeSystemTool runs safely without crash", async () => {
  const res = await executeNativeSystemTool("get_frontmost_app", {});
  assert.ok(res !== null);
  assert.equal(typeof res.output, "string");
  assert.ok(res.output.length > 0);
});

test("Feature 4: Conversation History saves and exports turns in json and txt formats", () => {
  const sessId = `test_hist_${Date.now()}`;
  recordHistoryTurns(sessId, [
    { role: "user", content: "Hello JXEngine" },
    { role: "assistant", content: "Ready to assist you." },
  ]);

  const loaded = loadHistorySession(sessId);
  assert.ok(loaded);
  assert.equal(loaded.turns.length, 2);

  const jsonExport = exportHistoryFormatted(sessId, "json");
  assert.ok(jsonExport.includes("Hello JXEngine"));

  const txtExport = exportHistoryFormatted(sessId, "txt");
  assert.ok(txtExport.includes("USER:"));
  assert.ok(txtExport.includes("Ready to assist you."));
});
