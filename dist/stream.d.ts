import { ServerResponse } from "node:http";
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
export declare function proxyAnthropicStream(upstreamRes: Response, clientRes: ServerResponse, modelName: string): Promise<void>;
//# sourceMappingURL=stream.d.ts.map