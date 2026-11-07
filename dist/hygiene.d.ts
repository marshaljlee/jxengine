/**
 * Response Hygiene & Template Token Sanitizer
 * Strips Jinja control tokens, template delimiters, and isolates thinking blocks.
 * Prevents prompt format leakages to Claude Code, Codex, Hermes, and other agents.
 */
export declare const HIDDEN_CONTROL_TOKENS: string[];
export interface SanitizedResponse {
    cleanContent: string;
    reasoningContent?: string;
}
export declare function sanitizeModelResponse(rawText: string): SanitizedResponse;
//# sourceMappingURL=hygiene.d.ts.map