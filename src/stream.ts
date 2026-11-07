import { IncomingMessage, ServerResponse } from "node:http";
import { sanitizeModelResponse } from "./hygiene.js";

/**
 * Pipes an upstream OpenAI SSE stream (/v1/chat/completions) into
 * an Anthropic Messages SSE event stream (/v1/messages).
 *
 * Translates:
 * - message_start
 * - content_block_start
 * - content_block_delta (text_delta & input_json_delta)
 * - content_block_stop
 * - message_delta
 * - message_stop
 */

export async function proxyAnthropicStream(
  upstreamRes: Response,
  clientRes: ServerResponse,
  modelName: string
): Promise<void> {
  clientRes.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const msgId = `msg_${Date.now()}`;

  // 1. message_start
  clientRes.write(
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: msgId,
        type: "message",
        role: "assistant",
        model: modelName,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })}\n\n`
  );

  let blockStarted = false;
  let activeToolBlockIndex = -1;
  let activeToolCallId = "";
  let activeToolName = "";
  let stopReason = "end_turn";

  if (!upstreamRes.body) {
    clientRes.end();
    return;
  }

  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const dataStr = trimmed.slice(6).trim();
      if (dataStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(dataStr);
        const choice = chunk.choices?.[0] || {};
        const delta = choice.delta || {};

        // A. Handle text content
        if (delta.content) {
          const { cleanContent } = sanitizeModelResponse(delta.content);
          if (cleanContent) {
            if (!blockStarted) {
              clientRes.write(
                `event: content_block_start\ndata: ${JSON.stringify({
                  type: "content_block_start",
                  index: 0,
                  content_block: { type: "text", text: "" },
                })}\n\n`
              );
              blockStarted = true;
            }

            clientRes.write(
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: cleanContent },
              })}\n\n`
            );
          }
        }

        // B. Handle tool calls delta
        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
          stopReason = "tool_use";
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              activeToolBlockIndex = 1;
              activeToolCallId = tc.id || `toolu_${Date.now()}`;
              activeToolName = tc.function.name;

              clientRes.write(
                `event: content_block_start\ndata: ${JSON.stringify({
                  type: "content_block_start",
                  index: activeToolBlockIndex,
                  content_block: {
                    type: "tool_use",
                    id: activeToolCallId,
                    name: activeToolName,
                    input: {},
                  },
                })}\n\n`
              );
            }

            if (tc.function?.arguments) {
              clientRes.write(
                `event: content_block_delta\ndata: ${JSON.stringify({
                  type: "content_block_delta",
                  index: activeToolBlockIndex >= 0 ? activeToolBlockIndex : 1,
                  delta: {
                    type: "input_json_delta",
                    partial_json: tc.function.arguments,
                  },
                })}\n\n`
              );
            }
          }
        }

        if (choice.finish_reason === "tool_calls") {
          stopReason = "tool_use";
        }
      } catch {}
    }
  }

  // Close blocks
  if (blockStarted) {
    clientRes.write(
      `event: content_block_stop\ndata: ${JSON.stringify({
        type: "content_block_stop",
        index: 0,
      })}\n\n`
    );
  }
  if (activeToolBlockIndex >= 0) {
    clientRes.write(
      `event: content_block_stop\ndata: ${JSON.stringify({
        type: "content_block_stop",
        index: activeToolBlockIndex,
      })}\n\n`
    );
  }

  // message_delta & message_stop
  clientRes.write(
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 10 },
    })}\n\n`
  );

  clientRes.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
  clientRes.end();
}

