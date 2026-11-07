import test from "node:test";
import assert from "node:assert/strict";
import { inferTemplate } from "../dist/gguf.js";
import { detectKapitsaBinary, listKapitsaModels } from "../dist/mlx.js";
import { UniversalGateway } from "../dist/server.js";
import { ModelRuntimeOrchestrator } from "../dist/runtime.js";
import { anthropicToOpenAi, openAiToAnthropic } from "../dist/anthropic.js";
import { autoConfigureModel, detectSystemHardware } from "../dist/autoconfig.js";
import { extractTextualToolCalls } from "../dist/tools.js";
import { sanitizeModelResponse } from "../dist/hygiene.js";
import { applyInstructionGuardrails, RepetitionLoopDetector } from "../dist/guardrails.js";
import { executeWithRetry, validateToolCallPayload, pruneContextToFit } from "../dist/resilience.js";
import { saveSessionState, loadSessionState, clearSessionState } from "../dist/recovery.js";
import { runPreflightDiagnostics } from "../dist/diagnostics.js";
import { humanizeOutput } from "../dist/humanizer.js";
import { normalizeVisionInput } from "../dist/vision.js";

test("GGUF template inference matches architectures", () => {
  assert.equal(inferTemplate("DeepSeek-R1-Distill-Qwen-14B.gguf"), "deepseek");
  assert.equal(inferTemplate("Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf"), "chatml");
  assert.equal(inferTemplate("Llama-3.1-8B-Instruct.gguf"), "llama3");
  assert.equal(inferTemplate("Mistral-7B-Instruct-v0.3.gguf"), "mistral-v3");
});

test("Kapitsa discovery identifies binary and models", () => {
  const bin = detectKapitsaBinary();
  assert.ok(bin !== null, "Kapitsa binary should be detected on Mac");
  const models = listKapitsaModels();
  assert.ok(models.length > 0, "Kapitsa catalog should list available models");
  assert.equal(models[0].format, "mlx");
});

test("Auto-configuration adapts parameters to host hardware", () => {
  const hw = detectSystemHardware();
  assert.ok(hw.totalMemoryGb > 0);
  assert.ok(hw.cpuCores > 0);

  const mockModel = {
    id: "test-model",
    fileName: "test.gguf",
    path: "/tmp/test.gguf",
    sizeBytes: 15 * 1024 * 1024 * 1024,
    format: "gguf",
    contextLength: 32768,
    modifiedAt: Date.now(),
  };

  const autoOpts = autoConfigureModel(mockModel, hw);
  assert.equal(autoOpts.flashAttn, true);
  assert.ok(autoOpts.nCtx >= 4096);
  assert.ok(autoOpts.threads >= 1);
});

test("Tool calling interceptor catches and translates Qwen and Hermes dialect", () => {
  const qwenText = "Let me check the weather.<tool_call>{\"name\": \"get_weather\", \"arguments\": {\"city\": \"Tokyo\"}}</tool_call>";
  const qwenRes = extractTextualToolCalls(qwenText);
  assert.equal(qwenRes.cleanText, "Let me check the weather.");
  assert.equal(qwenRes.calls.length, 1);
  assert.equal(qwenRes.calls[0].name, "get_weather");
  assert.equal(qwenRes.calls[0].arguments.city, "Tokyo");

  const hermesText = "I will read the file now.<invoke name=\"read_file\"><parameter name=\"path\">/tmp/test.txt</parameter></invoke>";
  const hermesRes = extractTextualToolCalls(hermesText);
  assert.equal(hermesRes.cleanText, "I will read the file now.");
  assert.equal(hermesRes.calls.length, 1);
  assert.equal(hermesRes.calls[0].name, "read_file");
  assert.equal(hermesRes.calls[0].arguments.path, "/tmp/test.txt");
});

test("Anthropic /v1/messages tool translation converts both ways", () => {
  const anthropicReq = {
    model: "claude-3-5-sonnet",
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "File contents: hello" }
        ]
      }
    ],
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } } }
      }
    ]
  };

  const openAiReq = anthropicToOpenAi(anthropicReq);
  assert.equal(openAiReq.messages[1].role, "tool");
  assert.equal(openAiReq.tools[0].function.name, "read_file");

  const openAiRes = {
    choices: [
      {
        message: {
          role: "assistant",
          content: "Calling tool.<tool_call>{\"name\": \"read_file\", \"arguments\": {\"path\": \"/etc/hosts\"}}</tool_call>"
        },
        finish_reason: "stop"
      }
    ]
  };

  const anthropicRes = openAiToAnthropic(openAiRes, "claude-3-5-sonnet");
  assert.equal(anthropicRes.stop_reason, "tool_use");
  assert.equal(anthropicRes.content.length, 2);
  assert.equal(anthropicRes.content[0].type, "text");
  assert.equal(anthropicRes.content[1].type, "tool_use");
  assert.equal(anthropicRes.content[1].name, "read_file");
  assert.equal(anthropicRes.content[1].input.path, "/etc/hosts");
});

test("Sanitizer strips leaked control tokens and isolates thinking blocks", () => {
  const dirtyOutput = "<|im_start|>assistant\n<think>I need to solve the user equation.</think>Here is the final answer: 42<|im_end|>";
  const clean = sanitizeModelResponse(dirtyOutput);
  assert.equal(clean.cleanContent, "Here is the final answer: 42");
  assert.equal(clean.reasoningContent, "I need to solve the user equation.");
});

test("Rule 4 & 49: Humanizer removes conversational preambles and AI clichés", () => {
  const text = "Certainly! Here is your code. We will delve into the implementation furthermore.";
  const humanized = humanizeOutput(text);
  assert.equal(humanized, "We will examine the implementation also.");
});

test("Rule 11: Multimodal Vision Input normalizes Anthropic base64 into OpenAI image_url", () => {
  const anthropicContent = [
    { type: "text", text: "Look at this screenshot" },
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAA" }
    }
  ];
  const normalized = normalizeVisionInput(anthropicContent);
  assert.ok(Array.isArray(normalized));
  assert.equal(normalized[1].type, "image_url");
  assert.equal(normalized[1].image_url.url, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA");
});

test("Rule 16: Diagnostics reports hardware profile and binary readiness", () => {
  const diag = runPreflightDiagnostics();
  assert.ok(diag.hardware.totalMemoryGb > 0);
  assert.ok(diag.memoryAssessment.recommendedMaxModelGb > 0);
});

test("Guardrail applies Sandwich Re-Anchoring and Anti-Laziness", () => {
  const messages = [
    { role: "user", content: "Refactor the authentication module completely." }
  ];
  const guarded = applyInstructionGuardrails(messages);
  assert.equal(guarded.length, 2);
  assert.equal(guarded[0].role, "system");
  assert.ok(guarded[0].content.includes("ANTI-LAZINESS PROTOCOL"));
  assert.ok(guarded[1].content.includes("ATTENTION RE-ANCHOR"));
});

test("RepetitionLoopDetector catches repeating loops", () => {
  const detector = new RepetitionLoopDetector();
  const phrase = "The quick brown fox jumps over";
  detector.feed(phrase);
  detector.feed(phrase);
  const third = detector.feed(phrase);
  assert.equal(third.isLooping, true);
});

test("UniversalGateway serves panel, health, doctor, and Anthropic endpoints", async () => {
  const orchestrator = new ModelRuntimeOrchestrator();
  const gateway = new UniversalGateway({
    port: 9881,
    modelDirs: [],
    orchestrator,
  });

  await gateway.start();
  try {
    const healthRes = await fetch("http://127.0.0.1:9881/health");
    assert.equal(healthRes.status, 200);

    const doctorRes = await fetch("http://127.0.0.1:9881/api/doctor");
    assert.equal(doctorRes.status, 200);
    const doctorData = await doctorRes.json();
    assert.ok(doctorData.hardware.totalMemoryGb > 0);

    const panelRes = await fetch("http://127.0.0.1:9881/panel");
    assert.equal(panelRes.status, 200);
    const panelHtml = await panelRes.text();
    assert.ok(panelHtml.includes("JXEngine"));
  } finally {
    gateway.stop();
  }
});
