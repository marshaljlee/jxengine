/**
 * Middle-out conversation compactor for agentic sessions.
 * Preserves the vital root (system prompt, tools context) and the latest active turns,
 * while summarizing or pruning middle context to prevent context window overflow.
 */
export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content?: string | any;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}
export interface CompactionOptions {
    maxContextTokens?: number;
    preserveTailTurns?: number;
    preserveSystem?: boolean;
}
/**
 * Compacts a list of messages using middle-out pruning when estimated total tokens exceed maxContextTokens.
 */
export declare function compactConversation(messages: ChatMessage[], opts?: CompactionOptions): {
    messages: ChatMessage[];
    compacted: boolean;
    prunedCount: number;
};
//# sourceMappingURL=compactor.d.ts.map