import test from "node:test";
import assert from "node:assert/strict";
import { getDetailedMemorySnapshot, freeSystemRam, checkMemoryReservation } from "../dist/memory.js";

test("Memory subsystem reads detailed macOS pages and calculates available GB", () => {
  const snap = getDetailedMemorySnapshot();
  assert.ok(snap.totalBytes > 0);
  assert.ok(snap.totalGb > 0);
  assert.ok(snap.availableGb > 0);
  assert.ok(snap.availableBytes <= snap.totalBytes);
});

test("freeSystemRam purges unpinned buffers safely without throwing", () => {
  const result = freeSystemRam();
  assert.ok(result.before);
  assert.ok(result.after);
  assert.equal(typeof result.freedMb, "number");
});

test("checkMemoryReservation calculates requirement and deficit accurately", () => {
  // Test 1: Tiny model (500MB) should always fit
  const small = checkMemoryReservation(500 * 1024 * 1024, 2048);
  assert.equal(small.sufficient, true);
  assert.equal(small.deficitGb, 0);

  // Test 2: Huge model (500GB) should detect deficit
  const huge = checkMemoryReservation(500 * 1024 * 1024 * 1024, 32768);
  assert.equal(huge.sufficient, false);
  assert.ok(huge.deficitGb > 0);
  assert.ok(huge.requiredGb > 500);
});
