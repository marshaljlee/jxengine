/**
 * Response Hygiene & Template Token Sanitizer
 * Strips Jinja control tokens, template delimiters, and isolates thinking blocks.
 * Prevents prompt format leakages to Claude Code, Codex, Hermes, and other agents.
 */
export const HIDDEN_CONTROL_TOKENS = [
    "<|im_start|>",
    "<|im_end|>",
    "<|eot_id|>",
    "<|start_header_id|>",
    "<|end_header_id|>",
    "<|endoftext|>",
    "<|begin_of_text|>",
    "<|end_of_text|>",
    "<|file_separator|>",
    "<|assistant|>",
    "<|user|>",
    "<|system|>",
    "<|observation|>",
    "<|eom_id|>",
    "<|python_tag|>",
    "<|start|>",
    "<|end|>",
    "<|message|>",
    "<|constrain|>",
    "<|channel|>",
    "<channel|>",
    "<|tool_response|>",
    "<|/tool_response|>",
    "<|fim_prefix|>",
    "<|fim_middle|>",
    "<|fim_suffix|>",
    "<|end▁of▁sentence|>",
    "<<SYS>>",
    "<</SYS>>",
    "[INST]",
    "[/INST]",
    "<start_of_turn>",
    "<end_of_turn>",
    "<|reserved_special_token_0|>",
];
const HIDDEN_REGEX = new RegExp(HIDDEN_CONTROL_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
const ROLE_HEADER_REGEX = /^\s*(?:assistant|system|user)[ \t]*\n/i;
export function sanitizeModelResponse(rawText) {
    if (!rawText)
        return { cleanContent: "" };
    let text = rawText;
    let reasoning;
    // Extract <think>...</think> or <thought>...</thought> blocks (DeepSeek, Qwen, etc.)
    const thinkRegex = /<(think|thought|reasoning)>([\s\S]*?)<\/\1>/i;
    const match = text.match(thinkRegex);
    if (match) {
        reasoning = match[2].trim();
        text = text.replace(thinkRegex, "").trim();
    }
    // Remove leaked Jinja & ChatML control tokens
    text = text.replace(HIDDEN_REGEX, "");
    // Strip accidental leading role headers (e.g. "assistant\n")
    text = text.replace(ROLE_HEADER_REGEX, "");
    return {
        cleanContent: text.trim(),
        reasoningContent: reasoning,
    };
}
//# sourceMappingURL=hygiene.js.map