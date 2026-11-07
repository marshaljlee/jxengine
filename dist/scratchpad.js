/**
 * Multi-Turn Scratchpad State Isolation.
 * Strips reasoning tokens (<think>...</think>) from prior turns so local models
 * do not hallucinate self-prompting loops from their past scratchpads.
 */
/**
 * Strips <think>...</think> blocks from all historical turns,
 * preserving only the latest turn's scratchpad if requested.
 */
export function isolateHistoricalScratchpads(messages, keepLastTurnReasoning = false) {
    if (!Array.isArray(messages) || messages.length === 0)
        return messages;
    const result = [];
    const total = messages.length;
    for (let i = 0; i < total; i++) {
        const msg = messages[i];
        const isLastTurn = i === total - 1;
        if (typeof msg.content === "string") {
            if (isLastTurn && keepLastTurnReasoning) {
                result.push(msg);
            }
            else {
                // Strip out <think> blocks
                const stripped = msg.content
                    .replace(/<think>[\s\S]*?<\/think>/gi, "")
                    .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, "")
                    .trim();
                result.push({
                    ...msg,
                    content: stripped,
                });
            }
        }
        else {
            result.push(msg);
        }
    }
    return result;
}
//# sourceMappingURL=scratchpad.js.map