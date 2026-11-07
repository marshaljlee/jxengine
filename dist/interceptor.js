/**
 * Dynamic Stop-Token & Tool Call Interceptor.
 * Prevents local models from hallucinating tool execution output or simulating environment responses.
 */
export const DIALECT_STOP_TOKENS = [
    "</tool_call>",
    "</invoke>",
    "</function>",
    "<|im_end|>",
    "<|eot_id|>",
    "```output",
    "```result",
    "\nObservation:",
    "\nTool Output:",
];
/**
 * Returns dynamic stop sequences based on presence of tools.
 */
export function getDynamicStopTokens(hasTools, userStop) {
    const stops = new Set();
    if (Array.isArray(userStop)) {
        userStop.forEach((s) => stops.add(s));
    }
    else if (typeof userStop === "string" && userStop) {
        stops.add(userStop);
    }
    if (hasTools) {
        DIALECT_STOP_TOKENS.forEach((t) => stops.add(t));
    }
    return Array.from(stops);
}
/**
 * Truncates model generation if it begins hallucinating tool return values or observation blocks.
 */
export function truncateHallucinatedObservation(text) {
    if (!text)
        return { cleanText: text, truncated: false };
    const patterns = [
        /<\/tool_call>[\s\S]*/i,
        /<\/invoke>[\s\S]*/i,
        /<\/function>[\s\S]*/i,
        /\n(?:Observation|Tool Output|Output):\s*[\s\S]*/i,
        /```output[\s\S]*/i,
    ];
    for (const pat of patterns) {
        const match = text.match(pat);
        if (match && match.index !== undefined) {
            // Find where tool call ends
            let cutIndex = match.index;
            if (text.slice(match.index).startsWith("</tool_call>")) {
                cutIndex += "</tool_call>".length;
            }
            else if (text.slice(match.index).startsWith("</invoke>")) {
                cutIndex += "</invoke>".length;
            }
            else if (text.slice(match.index).startsWith("</function>")) {
                cutIndex += "</function>".length;
            }
            return {
                cleanText: text.slice(0, cutIndex).trimEnd(),
                truncated: true,
            };
        }
    }
    return { cleanText: text, truncated: false };
}
//# sourceMappingURL=interceptor.js.map