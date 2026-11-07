import test from "node:test";
import assert from "node:assert/strict";
import { BillionContextEngine, ACP_TOOLS_SCHEMA } from "../dist/billion.js";

test("BillionContextEngine tags messages with addressable sequence IDs", () => {
  const engine = new BillionContextEngine();
  const raw = [
    { role: "system", content: "System instructions" },
    { role: "user", content: "Run analysis" },
  ];
  const tagged = engine.tagMessages(raw);
  assert.equal(tagged[0].id, "m00001");
  assert.equal(tagged[1].id, "m00002");
  assert.ok(tagged[1].content.includes("<acp:m00002>"));
});

test("BillionContextEngine compresses message range into high-fidelity block", () => {
  const engine = new BillionContextEngine();
  const session = engine.getOrCreateSession("test-session");
  session.messages = engine.tagMessages([
    { role: "system", content: "System prompt" },
    { role: "user", content: "Step 1" },
    { role: "assistant", content: "Doing step 1" },
    { role: "user", content: "Step 2" },
    { role: "assistant", content: "Doing step 2" },
    { role: "user", content: "Final prompt" },
  ]);

  const res = engine.compressRange(session, "m00002", "m00005", "Completed steps 1 and 2 successfully.");
  assert.equal(res.success, true);
  assert.ok(res.blockId);
  assert.equal(session.compressedBlocks.size, 1);
  assert.equal(session.messages.length, 3); // system + compressed block + final prompt
  assert.ok(session.messages[1].content.includes("[COMPRESSED CONTEXT"));
});

test("BillionContextEngine reversibly decompresses a compressed block", () => {
  const engine = new BillionContextEngine();
  const session = engine.getOrCreateSession("test-decompress");
  session.messages = engine.tagMessages([
    { role: "system", content: "System prompt" },
    { role: "user", content: "Message to compress" },
    { role: "user", content: "Tail message" },
  ]);

  const compRes = engine.compressRange(session, "m00002", "m00003", "Summary of m00002 and m00003");
  assert.equal(compRes.success, true);
  assert.equal(session.messages.length, 2); // system + block

  const decompRes = engine.decompressBlock(session, compRes.blockId);
  assert.equal(decompRes.success, true);
  assert.equal(session.messages.length, 3); // system + 2 restored messages
  assert.ok(session.messages[1].content.includes("Message to compress"));
});

test("BillionContextEngine searches deep history across active and compressed blocks", () => {
  const engine = new BillionContextEngine();
  const session = engine.getOrCreateSession("test-search");
  session.messages = engine.tagMessages([
    { role: "system", content: "System" },
    { role: "user", content: "Secret token: ALPHA_9942" },
    { role: "user", content: "Active inquiry" },
  ]);

  const compRes = engine.compressRange(session, "m00002", "m00002", "Compressed secret token block");
  const hits = engine.searchContext(session, "ALPHA_9942");
  assert.ok(hits.length > 0);
  assert.ok(hits[0].snippet.includes("ALPHA_9942"));
});

test("BillionContextEngine ACP Tools Schema contains all 5 specification tools", () => {
  const names = ACP_TOOLS_SCHEMA.map((t) => t.function.name);
  assert.deepEqual(names, ["compress", "decompress", "search_context", "acp_status", "acp_rule"]);
});
