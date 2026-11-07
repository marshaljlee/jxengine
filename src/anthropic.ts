import { extractTextualToolCalls } from "./tools.js";
import { sanitizeModelResponse } from "./hygiene.js";
import { applyInstructionGuardrails } from "./guardrails.js";
import { humanizeOutput } from "./humanizer.js";
import { normalizeVisionInput } from "./vision.js";
import { repairAndParseJson } from "./repair.js";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; [key: string]: any }>;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: any[];
}

export function anthropicToOpenAi(req: AnthropicRequest): Record<string, any> {
  const openAiMessages: Array<Record<string, any>> = [];

  if (req.system) {
    openAiMessages.push({ role: "system", content: req.system });
  }

  for (const m of req.messages || []) {
    if (typeof m.content === "string") {
      openAiMessages.push({ role: m.role, content: m.content });
      continue;
    }

    if (Array.isArray(m.content)) {
      const textParts: string[] = [];
      const imageBlocks: any[] = [];
      const toolCalls: any[] = [];
      const toolResults: any[] = [];

      for (const block of m.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "image") {
          const norm = normalizeVisionInput([block]);
          if (Array.isArray(norm) && norm[0]?.type === "image_url") {
            imageBlocks.push(norm[0]);
          }
        } else if (block.type === "image_url") {
          imageBlocks.push(block);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id || `call_${Date.now()}`,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {}),
            },
          });
        } else if (block.type === "tool_result") {
          let resContent = block.content;
          if (Array.isArray(resContent)) {
            resContent = resContent.map((p) => p.text || "").join(" ");
          }
          toolResults.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: String(resContent || ""),
          });
        }
      }

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          openAiMessages.push(tr);
        }
      } else {
        const formatted: Record<string, any> = {
          role: m.role,
        };
        if (imageBlocks.length > 0) {
          const parts: any[] = [];
          if (textParts.length > 0) parts.push({ type: "text", text: textParts.join("\n") });
          parts.push(...imageBlocks);
          formatted.content = parts;
        } else {
          formatted.content = textParts.join("\n");
        }
        if (toolCalls.length > 0) {
          formatted.tool_calls = toolCalls;
        }
        openAiMessages.push(formatted);
      }
    }
  }

  // Map tools schema
  const openAiTools: any[] = [];
  if (req.tools && Array.isArray(req.tools)) {
    for (const t of req.tools) {
      openAiTools.push({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema || {},
        },
      });
    }
  }

  return {
    model: req.model,
    messages: applyInstructionGuardrails(openAiMessages as any),
    tools: openAiTools.length > 0 ? openAiTools : undefined,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
    top_p: req.top_p,
    stream: req.stream ?? false,
  };
}

export function openAiToAnthropic(res: Record<string, any>, modelName: string): Record<string, any> {
  const choices = res.choices || [];
  const first = choices[0] || {};
  const msg = first.message || {};
  const rawContent = msg.content || "";

  // 1. Sanitize control tokens and isolate <think> blocks
  const { cleanContent, reasoningContent } = sanitizeModelResponse(rawContent);

  // 2. Extract and strip any textual tool calls
  const contentBlocks: any[] = [];
  const { cleanText, calls } = extractTextualToolCalls(cleanContent);

  if (cleanText) {
    // Vault Rule 4 & 49: Soft-humanize without forcing or breaking code
    const humanized = humanizeOutput(cleanText);
    contentBlocks.push({
      type: "text",
      text: humanized,
    });
  }

  // Add native tool calls if emitted by upstream model
  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      let args = {};
      if (typeof tc.function?.arguments === "string") {
        const repaired = repairAndParseJson(tc.function.arguments);
        args = repaired.success && repaired.data ? repaired.data : {};
      } else if (typeof tc.function?.arguments === "object" && tc.function?.arguments !== null) {
        args = tc.function.arguments;
      }
      const rawId = tc.id || `toolu_${Date.now()}`;
      const toolId = rawId.startsWith("toolu_") ? rawId : `toolu_${rawId}`;
      contentBlocks.push({
        type: "tool_use",
        id: toolId,
        name: tc.function?.name,
        input: args,
      });
    }
  }

  // Add intercepted textual tool calls
  for (const c of calls) {
    const rawId = c.id || `toolu_${Date.now()}`;
    const toolId = rawId.startsWith("toolu_") ? rawId : `toolu_${rawId}`;
    contentBlocks.push({
      type: "tool_use",
      id: toolId,
      name: c.name,
      input: c.arguments,
    });
  }

  const hasTools = contentBlocks.some((b) => b.type === "tool_use");

  return {
    id: res.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: modelName,
    content: contentBlocks,
    stop_reason: hasTools ? "tool_use" : first.finish_reason === "stop" ? "end_turn" : "max_tokens",
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens || 0,
      output_tokens: res.usage?.completion_tokens || 0,
    },
  };
}
