import { ParsedToolCall } from "./tools.js";
/**
 * Vault Rule 3: Auto-Retry with Exponential Backoff
 * Retries network/engine hiccups seamlessly up to maxRetries.
 */
export declare function executeWithRetry<T>(fn: () => Promise<T>, maxRetries?: number, initialDelayMs?: number): Promise<T>;
/**
 * Vault Rule 53: Tool Call Argument Size Limit & Payload Guard
 * Guards against massive out-of-spec JSON payload allocations that can crash V8.
 */
export declare const MAX_SAFE_TOOL_ARG_BYTES: number;
export declare function validateToolCallPayload(call: ParsedToolCall): boolean;
/**
 * Vault Rule 7 & Rule 42: Context Window Sliding & Middle Pruning
 * Prevents context exhaustion by pruning middle conversational turns
 * while strictly preserving the system prompt and the latest user turns.
 */
export declare function pruneContextToFit(messages: Array<{
    role: string;
    content: string | any[];
}>, maxEstimatedTokens?: number): Array<{
    role: string;
    content: string | any[];
}>;
//# sourceMappingURL=resilience.d.ts.map