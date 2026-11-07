import test from "node:test";
import assert from "node:assert/strict";
import { ModelCatalogService } from "../dist/catalog.js";
import { formatApiError, ModelNotFoundError, InsufficientMemoryError, NoActiveModelError } from "../dist/errors.js";
import { getDefaultModelDirs } from "../dist/config.js";

test("ModelCatalogService caches and resolves models without duplicates", async () => {
  const catalogService = new ModelCatalogService(5000);
  const dirs = getDefaultModelDirs();
  
  const catalog = await catalogService.getCatalog(dirs);
  assert.ok(Array.isArray(catalog.all));
  assert.ok(Array.isArray(catalog.gguf));
  assert.ok(Array.isArray(catalog.mlx));

  // Verify uniqueness of model IDs
  const idSet = new Set(catalog.all.map((m) => m.id));
  assert.equal(idSet.size, catalog.all.length);
});

test("formatApiError generates standardized OpenAI/Anthropic error responses", () => {
  const notFound = new ModelNotFoundError("non-existent-model");
  const notFoundFmt = formatApiError(notFound);
  assert.equal(notFoundFmt.statusCode, 404);
  assert.equal(notFoundFmt.payload.error.code, "model_not_found");
  assert.equal(notFoundFmt.payload.error.type, "not_found_error");

  const memErr = new InsufficientMemoryError(16, 8);
  const memFmt = formatApiError(memErr);
  assert.equal(memFmt.statusCode, 400);
  assert.equal(memFmt.payload.error.code, "insufficient_memory");

  const noModelErr = new NoActiveModelError();
  const noModelFmt = formatApiError(noModelErr);
  assert.equal(noModelFmt.statusCode, 503);
  assert.equal(noModelFmt.payload.error.code, "no_active_model");

  const genericErr = formatApiError(new Error("Unexpected crash"));
  assert.equal(genericErr.statusCode, 500);
  assert.equal(genericErr.payload.error.type, "api_error");
});

test("getDefaultModelDirs parameterizes paths and includes standard locations", () => {
  const dirs = getDefaultModelDirs();
  assert.ok(dirs.length > 0);
  assert.ok(dirs.some((d) => d.includes(".ollama")));
});

