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

export const ANTI_LAZINESS_DIRECTIVE = `
[INVARIANT EXECUTION MANDATE - ANTI-LAZINESS PROTOCOL]
1. ZERO-AGENCY DIRECT EXECUTION: Do not describe or announce your next action in future tense. Do not say "Next, I will...", "Now let's do...", or "I will proceed with...". Immediately execute the code, tool call, or task directly.
2. NO POLITE PREMATURE HALTING: Never terminate a response with conversational cop-outs such as "Let me know if you would like me to continue", "Shall I proceed?", or "Want me to do the rest?". Keep generating until the complete solution, all files, or the full checklist are completely finished.
3. ZERO PLACEHOLDERS OR ELLIPSES: Never emit placeholders, "TODO", "// ...rest of code...", or partial summaries. Provide 100% complete, working, un-truncated outputs.
`.trim();

export const RECENCY_SANDWICH_ANCHOR = `
[ATTENTION RE-ANCHOR: CRITICAL NON-NEGOTIABLE REMINDER]
Complete the task directly right now. Output all code and actions in full without stopping early, skipping steps, or asking for permission to continue.
`.trim();

/**
 * Injects anti-laziness directives and applies sandwich re-anchoring
 * to combat "Lost in the Middle" instruction dropping.
 */
export function applyInstructionGuardrails(
  messages: Array<{ role: string; content: string | any[] }>,
  opts: GuardrailOptions = {}
): Array<{ role: string; content: string | any[] }> {
  if (messages.length === 0) return messages;

  const result = [...messages];

  // 1. Prime the attention sink (Primacy Effect) in the system prompt
  let sysIdx = result.findIndex((m) => m.role === "system");
  if (sysIdx >= 0) {
    const existing = typeof result[sysIdx].content === "string" ? result[sysIdx].content : "";
    result[sysIdx] = {
      ...result[sysIdx],
      content: `${ANTI_LAZINESS_DIRECTIVE}\n\n${existing}`.trim(),
    };
  } else {
    result.unshift({
      role: "system",
      content: ANTI_LAZINESS_DIRECTIVE,
    });
  }

  // 2. Sandwich Re-Anchoring (Recency Effect) right before generation begins
  if (opts.enableSandwichAnchor !== false) {
    let lastUserIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx >= 0) {
      const userMsg = result[lastUserIdx];
      if (typeof userMsg.content === "string") {
        result[lastUserIdx] = {
          ...userMsg,
          content: `${userMsg.content}\n\n${RECENCY_SANDWICH_ANCHOR}`,
        };
      }
    }
  }

  return result;
}

/**
 * Loop detector that tracks repeating n-grams in streamed or completed text
 * and truncates runaway structural loops.
 */
export class RepetitionLoopDetector {
  private buffer = "";
  private seenPhrases = new Map<string, number>();

  feed(chunk: string): { isLooping: boolean; safeChunk: string } {
    this.buffer += chunk;
    if (this.buffer.length < 40) {
      return { isLooping: false, safeChunk: chunk };
    }

    // Check last 60 characters for tight repeating cycles (e.g. phrase repeated 3+ times)
    const windowSize = 30;
    if (this.buffer.length >= windowSize * 3) {
      const tail = this.buffer.slice(-windowSize * 3);
      const partA = tail.slice(0, windowSize);
      const partB = tail.slice(windowSize, windowSize * 2);
      const partC = tail.slice(windowSize * 2);

      if (partA === partB && partB === partC) {
        return { isLooping: true, safeChunk: "" };
      }
    }

    return { isLooping: false, safeChunk: chunk };
  }
}
