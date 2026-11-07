import test from "node:test";
import assert from "node:assert/strict";
import { UpdateSurvivalManager } from "../dist/survival.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("UpdateSurvivalManager creates and persists lifeboat manifest across versions", () => {
  const testDir = join(tmpdir(), `jxengine_survival_test_${Date.now()}`);
  const survival = new UpdateSurvivalManager(testDir);

  const mockModel = {
    id: "qwen-coder.gguf",
    name: "qwen-coder",
    fileName: "qwen-coder.gguf",
    path: "/Volumes/Hermes/models/qwen-coder.gguf",
    sizeBytes: 4000000000,
    format: "gguf",
    contextLength: 32768,
    modifiedAt: Date.now(),
  };

  // 1. Host app preparing to update from v1.0.0
  const manifest = survival.prepareUpdateHandoff(
    "TestHostApp",
    "1.0.0",
    {
      descriptor: mockModel,
      port: 18080,
      options: { nCtx: 8192, nGPULayers: 99 },
    },
    8080,
    ["/Volumes/Hermes/models"]
  );

  assert.equal(manifest.appName, "TestHostApp");
  assert.equal(manifest.appVersion, "1.0.0");
  assert.equal(manifest.survivedUpdatesCount, 1);
  assert.equal(manifest.activeModel?.id, "qwen-coder.gguf");

  // 2. New host app version v2.0.0 launches and detects pending resurrection
  assert.equal(survival.hasPendingResurrection("2.0.0"), true);

  // 3. Acknowledge update resurrection
  survival.acknowledgeResurrection("2.0.0");
  const reloaded = survival.loadManifest();
  assert.equal(reloaded?.appVersion, "2.0.0");
  assert.equal(reloaded?.previousAppVersion, "1.0.0");
});
