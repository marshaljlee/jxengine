/**
 * Dynamic Stop-Token & Tool Call Interceptor.
 * Prevents local models from hallucinating tool execution output or simulating environment responses.
 */
export declare const DIALECT_STOP_TOKENS: string[];
/**
 * Returns dynamic stop sequences based on presence of tools.
 */
export declare function getDynamicStopTokens(hasTools: boolean, userStop?: string | string[]): string[];
/**
 * Truncates model generation if it begins hallucinating tool return values or observation blocks.
 */
export declare function truncateHallucinatedObservation(text: string): {
    cleanText: string;
    truncated: boolean;
};
//# sourceMappingURL=interceptor.d.ts.map