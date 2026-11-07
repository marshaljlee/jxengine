/**
 * Universal JSON Repair and Sanitizer for Local LLM Tool Arguments.
 * Handles unquoted keys, truncated strings, missing closing braces,
 * trailing commas, and escaped markdown code fences.
 */
export declare function repairAndParseJson<T = any>(raw: string): {
    success: boolean;
    data: T | null;
    error?: string;
};
/**
 * Ensures a valid stringified JSON argument payload for tool execution.
 * If raw argument string is broken, repairs it into valid JSON string.
 */
export declare function sanitizeToolArguments(rawArgs: string | Record<string, any>): string;
//# sourceMappingURL=repair.d.ts.map