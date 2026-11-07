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

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.6);
}

function estimateMessageTokens(msg: ChatMessage): number {
  let count = 4; // overhead
  if (typeof msg.content === "string") {
    count += estimateTokens(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === "text" && part.text) count += estimateTokens(part.text);
    }
  }
  if (msg.tool_calls) {
    count += estimateTokens(JSON.stringify(msg.tool_calls));
  }
  return count;
}

/**
 * Compacts a list of messages using middle-out pruning when estimated total tokens exceed maxContextTokens.
 */
export function compactConversation(
  messages: ChatMessage[],
  opts: CompactionOptions = {}
): { messages: ChatMessage[]; compacted: boolean; prunedCount: number } {
  const maxTokens = opts.maxContextTokens || 16384;
  const tailTurns = opts.preserveTailTurns || 4;

  let totalTokens = messages.reduce((acc, m) => acc + estimateMessageTokens(m), 0);
  if (totalTokens <= maxTokens || messages.length <= tailTurns + 2) {
    return { messages, compacted: false, prunedCount: 0 };
  }

  // Identify system messages (head)
  const systemMessages: ChatMessage[] = [];
  const nonSystem: ChatMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemMessages.push(m);
    } else {
      nonSystem.push(m);
    }
  }

  // Preserve tail
  const tail = nonSystem.slice(-tailTurns);
  const candidateMiddle = nonSystem.slice(0, -tailTurns);

  let prunedCount = 0;
  const retainedMiddle: ChatMessage[] = [];

  // Compact middle by dropping old verbose tool outputs or summarizing
  for (let i = 0; i < candidateMiddle.length; i++) {
    const msg = candidateMiddle[i];
    // If it's a long tool output in middle, truncate it
    if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > 500) {
      prunedCount++;
      retainedMiddle.push({
        ...msg,
        content: msg.content.slice(0, 250) + "\n... [Context compacted: tool output truncated to preserve window] ...\n" + msg.content.slice(-100),
      });
    } else {
      retainedMiddle.push(msg);
    }
  }

  // Re-calculate
  let assembled = [...systemMessages, ...retainedMiddle, ...tail];
  totalTokens = assembled.reduce((acc, m) => acc + estimateMessageTokens(m), 0);

  // If still oversized, drop middle messages from the oldest non-system turn
  while (totalTokens > maxTokens && retainedMiddle.length > 1) {
    const dropped = retainedMiddle.shift();
    if (dropped) {
      prunedCount++;
      totalTokens -= estimateMessageTokens(dropped);
    }
  }

  const result = [...systemMessages, ...retainedMiddle, ...tail];
  return {
    messages: result,
    compacted: prunedCount > 0,
    prunedCount,
  };
}

