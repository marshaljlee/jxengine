/**
 * Vault Rule 4 (Natural Voice Humanizer) & Rule 49 (Simplified Technical English)
 *
 * Adaptive filter: Cleans AI conversational clichés, filler preambles, and sycophantic padding
 * without breaking code, JSON, math, or structured function calls.
 */
const AI_CLICHE_PREFIXES = [
    /^(?:Certainly|Sure|Of course|Absolutely|Definitely)[!.,]?\s*(?:Here(?:'s| is) (?:the|your) (?:code|solution|response|answer)[!.:]?\s*)?/i,
    /^As an AI(?: language model)?[,.]?\s*/i,
    /^I'd be happy to help with that[!.]?\s*/i,
    /^Great question[!.]?\s*/i,
];
const AI_TELL_WORDS = [
    /\bdelve into\b/gi,
    /\bfurthermore,\b/gi,
    /\bmoreover,\b/gi,
    /\bin conclusion,\b/gi,
    /\bit is important to remember that\b/gi,
    /\bseamlessly\b/gi,
    /\btapestry\b/gi,
];
export function humanizeOutput(text) {
    if (!text)
        return "";
    let result = text;
    // 1. Strip canned AI opening preambles
    for (const prefix of AI_CLICHE_PREFIXES) {
        result = result.replace(prefix, "");
    }
    // 2. Soft-replace heavy AI-tell clichés with direct plain English equivalents
    result = result
        .replace(/\bdelve into\b/gi, "examine")
        .replace(/\bfurthermore\b/gi, "also")
        .replace(/\bmoreover\b/gi, "also")
        .replace(/\bseamlessly\b/gi, "directly");
    return result.trim();
}
//# sourceMappingURL=humanizer.js.map