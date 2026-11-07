/**
 * Vault Rule 3: Auto-Retry with Exponential Backoff
 * Retries network/engine hiccups seamlessly up to maxRetries.
 */
export async function executeWithRetry(fn, maxRetries = 3, initialDelayMs = 500) {
    let attempt = 0;
    let delay = initialDelayMs;
    while (attempt < maxRetries) {
        try {
            return await fn();
        }
        catch (err) {
            attempt++;
            if (attempt >= maxRetries) {
                throw err;
            }
            // Add jitter to avoid thundering herds
            const jitter = delay * 0.2 * (Math.random() * 2 - 1);
            await new Promise((r) => setTimeout(r, delay + jitter));
            delay *= 2;
        }
    }
    throw new Error("executeWithRetry: exhausted retries");
}
/**
 * Vault Rule 53: Tool Call Argument Size Limit & Payload Guard
 * Guards against massive out-of-spec JSON payload allocations that can crash V8.
 */
export const MAX_SAFE_TOOL_ARG_BYTES = 2 * 1024 * 1024; // 2 MiB safety ceiling
export function validateToolCallPayload(call) {
    if (!call.arguments)
        return true;
    const str = JSON.stringify(call.arguments);
    if (Buffer.byteLength(str, "utf8") > MAX_SAFE_TOOL_ARG_BYTES) {
        call.arguments = {
            error: "TOOL_PAYLOAD_TOO_LARGE",
            message: `Tool argument size exceeded safety threshold of ${MAX_SAFE_TOOL_ARG_BYTES} bytes.`,
        };
        return false;
    }
    return true;
}
/**
 * Vault Rule 7 & Rule 42: Context Window Sliding & Middle Pruning
 * Prevents context exhaustion by pruning middle conversational turns
 * while strictly preserving the system prompt and the latest user turns.
 */
export function pruneContextToFit(messages, maxEstimatedTokens = 24000) {
    // Rough token estimation: 1 token ~ 3.5 chars
    function estimateTokens(msgs) {
        return msgs.reduce((acc, m) => {
            const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return acc + Math.ceil(text.length / 3.5);
        }, 0);
    }
    if (estimateTokens(messages) <= maxEstimatedTokens) {
        return messages;
    }
    // Preserve system prompt (if any) and last 3 messages (immediate working memory)
    const result = [...messages];
    const hasSystem = result.length > 0 && result[0].role === "system";
    const preservedHeadCount = hasSystem ? 1 : 0;
    const preservedTailCount = Math.min(3, result.length - preservedHeadCount);
    while (result.length > preservedHeadCount + preservedTailCount &&
        estimateTokens(result) > maxEstimatedTokens) {
        // Drop the oldest non-system message in the middle
        result.splice(preservedHeadCount, 1);
    }
    return result;
}
//# sourceMappingURL=resilience.js.map