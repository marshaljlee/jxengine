/**
 * Anti-Laziness, Anti-Loop & Sandwich Guardrail Layer
 *
 * Countermeasures for:
 * 1. Infinite repetition loops (DRY sampler params & streaming loop breaker)
 * 2. Conversational RLHF laziness ("I will now do X..." followed by halting)
 * 3. Instruction dropping & attention fading ("Lost in the middle")
 */
export interface GuardrailOptions {
    enableSandwichAnchor?: boolean;
    enableAntiLaziness?: boolean;
    enableLoopBreaker?: boolean;
}
export declare const ANTI_LAZINESS_DIRECTIVE: string;
export declare const RECENCY_SANDWICH_ANCHOR: string;
/**
 * Injects anti-laziness directives and applies sandwich re-anchoring
 * to combat "Lost in the Middle" instruction dropping.
 */
export declare function applyInstructionGuardrails(messages: Array<{
    role: string;
    content: string | any[];
}>, opts?: GuardrailOptions): Array<{
    role: string;
    content: string | any[];
}>;
/**
 * Loop detector that tracks repeating n-grams in streamed or completed text
 * and truncates runaway structural loops.
 */
export declare class RepetitionLoopDetector {
    private buffer;
    private seenPhrases;
    feed(chunk: string): {
        isLooping: boolean;
        safeChunk: string;
    };
}
//# sourceMappingURL=guardrails.d.ts.map