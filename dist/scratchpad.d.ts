/**
 * Multi-Turn Scratchpad State Isolation.
 * Strips reasoning tokens (<think>...</think>) from prior turns so local models
 * do not hallucinate self-prompting loops from their past scratchpads.
 */
export interface MessageWithContent {
    role: string;
    content?: string | any;
    [key: string]: any;
}
/**
 * Strips <think>...</think> blocks from all historical turns,
 * preserving only the latest turn's scratchpad if requested.
 */
export declare function isolateHistoricalScratchpads<T extends MessageWithContent>(messages: T[], keepLastTurnReasoning?: boolean): T[];
//# sourceMappingURL=scratchpad.d.ts.map