/**
 * Billion-Context ACP (Active Context Pruning) Engine.
 * Implements LSM-Tree hierarchical multi-generational context compression
 * and server-side cooperative tools:
 * - compress(from_id, to_id, summary)
 * - decompress(block_id)
 * - search_context(query)
 * - acp_status()
 * - acp_rule(rule)
 */

export interface AcpMessage {
  id: string; // e.g. m00001
  role: "system" | "user" | "assistant" | "tool";
  content: string | any;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  isCompressedBlock?: boolean;
  blockId?: string;
  originalMessages?: AcpMessage[];
}

export interface CompressedBlock {
  blockId: string;
  startId: string;
  endId: string;
  summary: string;
  rawMessages: AcpMessage[];
  tokenEstimate: number;
  compressedAt: number;
}

export interface AcpSessionState {
  sessionId: string;
  messages: AcpMessage[];
  compressedBlocks: Map<string, CompressedBlock>;
  persistentRules: string[];
  maxActiveTokens: number;
  totalTokensProcessed: number;
}

export const ACP_TOOLS_SCHEMA = [
  {
    type: "function" as const,
    function: {
      name: "compress",
      description: "Compresses a verbose range of past messages into a high-fidelity summary block (LSM-Tree compaction) to save active context window.",
      parameters: {
        type: "object",
        properties: {
          from_id: { type: "string", description: "Start message ID (e.g. m00002)" },
          to_id: { type: "string", description: "End message ID (e.g. m00008)" },
          summary: { type: "string", description: "Dense, lossless architectural summary of decisions, actions, and outputs taken in this range." },
        },
        required: ["from_id", "to_id", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "decompress",
      description: "Reversibly unpacks a previously compressed message block back into the active context if exact historical code or parameters are needed.",
      parameters: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "ID of the compressed block (e.g. blk_1731000)" },
        },
        required: ["block_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_context",
      description: "Performs full-text keyword or semantic search across all deep historical compressed blocks without unpacking the entire conversation.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword or pattern to search for in historical logs and summaries" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "acp_status",
      description: "Returns the current memory health, active token usage, compressible ranges, and list of compressed blocks.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "acp_rule",
      description: "Records a persistent principle-level directive or instruction that is hard-protected from being compressed or pruned away.",
      parameters: {
        type: "object",
        properties: {
          rule: { type: "string", description: "The persistent invariant rule or instruction" },
        },
        required: ["rule"],
      },
    },
  },
];

export class BillionContextEngine {
  private sessions = new Map<string, AcpSessionState>();

  getOrCreateSession(sessionId = "default"): AcpSessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        messages: [],
        compressedBlocks: new Map(),
        persistentRules: [],
        maxActiveTokens: 16384,
        totalTokensProcessed: 0,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /**
   * Assigns incremental sequence IDs (<acp:m00001>) to messages for addressable compression.
   */
  tagMessages(messages: any[]): AcpMessage[] {
    return messages.map((m, idx) => {
      const id = `m${String(idx + 1).padStart(5, "0")}`;
      let content = m.content;
      // Append invisible addressable tag if string
      if (typeof content === "string" && !content.includes("<acp:")) {
        content = `<!-- <acp:${id}> -->\n${content}`;
      }
      return {
        ...m,
        id,
        content,
      };
    });
  }

  /**
   * Executes compress(from_id, to_id, summary)
   */
  compressRange(
    session: AcpSessionState,
    fromId: string,
    toId: string,
    summary: string
  ): { success: boolean; blockId?: string; message: string } {
    const fromIdx = session.messages.findIndex((m) => m.id === fromId);
    const toIdx = session.messages.findIndex((m) => m.id === toId);

    if (fromIdx === -1 || toIdx === -1 || fromIdx > toIdx) {
      return { success: false, message: `Invalid range: ${fromId} to ${toId}` };
    }

    // Do not compress system prompt (index 0)
    if (fromIdx === 0 && session.messages[0].role === "system") {
      return { success: false, message: "System prompt (m00001) cannot be compressed." };
    }

    const blockId = `blk_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const rawToCompress = session.messages.slice(fromIdx, toIdx + 1);

    const block: CompressedBlock = {
      blockId,
      startId: fromId,
      endId: toId,
      summary,
      rawMessages: rawToCompress,
      tokenEstimate: Math.ceil(JSON.stringify(rawToCompress).length / 3.6),
      compressedAt: Date.now(),
    };

    session.compressedBlocks.set(blockId, block);

    // Replace range in session.messages with compressed summary block
    const compressedMessage: AcpMessage = {
      id: blockId,
      role: "assistant",
      content: `[COMPRESSED CONTEXT ${blockId} (${fromId}..${toId})]:\n${summary}`,
      isCompressedBlock: true,
      blockId,
      originalMessages: rawToCompress,
    };

    session.messages.splice(fromIdx, toIdx - fromIdx + 1, compressedMessage);

    return {
      success: true,
      blockId,
      message: `Successfully compressed ${rawToCompress.length} messages (${fromId}..${toId}) into block ${blockId}.`,
    };
  }

  /**
   * Executes decompress(block_id)
   */
  decompressBlock(
    session: AcpSessionState,
    blockId: string
  ): { success: boolean; message: string; restoredCount?: number } {
    const block = session.compressedBlocks.get(blockId);
    if (!block) {
      return { success: false, message: `Compressed block ${blockId} not found.` };
    }

    const idx = session.messages.findIndex((m) => m.blockId === blockId || m.id === blockId);
    if (idx === -1) {
      return { success: false, message: `Block ${blockId} is not in the active timeline.` };
    }

    // Restore original messages
    session.messages.splice(idx, 1, ...block.rawMessages);
    session.compressedBlocks.delete(blockId);

    return {
      success: true,
      restoredCount: block.rawMessages.length,
      message: `Decompressed block ${blockId}, restored ${block.rawMessages.length} messages.`,
    };
  }

  /**
   * Executes search_context(query)
   */
  searchContext(session: AcpSessionState, query: string): Array<{ source: string; snippet: string }> {
    const q = query.toLowerCase();
    const hits: Array<{ source: string; snippet: string }> = [];

    // Search active messages
    for (const m of session.messages) {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      if (text.toLowerCase().includes(q)) {
        hits.push({
          source: `active:${m.id} (${m.role})`,
          snippet: text.slice(0, 300),
        });
      }
    }

    // Search compressed blocks
    for (const [blockId, block] of session.compressedBlocks.entries()) {
      if (block.summary.toLowerCase().includes(q)) {
        hits.push({
          source: `summary:${blockId}`,
          snippet: block.summary.slice(0, 300),
        });
      }
      for (const raw of block.rawMessages) {
        const text = typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content);
        if (text.toLowerCase().includes(q)) {
          hits.push({
            source: `archived_raw:${blockId}:${raw.id}`,
            snippet: text.slice(0, 300),
          });
        }
      }
    }

    return hits.slice(0, 10);
  }

  /**
   * Executes acp_status()
   */
  getStatus(session: AcpSessionState): {
    totalMessages: number;
    compressedBlocksCount: number;
    blocks: Array<{ blockId: string; range: string; tokensSaved: number }>;
    persistentRules: string[];
    compressibleRange: { from: string; to: string } | null;
  } {
    const blocksInfo = Array.from(session.compressedBlocks.values()).map((b) => ({
      blockId: b.blockId,
      range: `${b.startId}..${b.endId}`,
      tokensSaved: b.tokenEstimate,
    }));

    let compressibleRange = null;
    if (session.messages.length > 6) {
      compressibleRange = {
        from: session.messages[1].id,
        to: session.messages[session.messages.length - 4].id,
      };
    }

    return {
      totalMessages: session.messages.length,
      compressedBlocksCount: session.compressedBlocks.size,
      blocks: blocksInfo,
      persistentRules: session.persistentRules,
      compressibleRange,
    };
  }

  /**
   * Executes acp_rule(rule)
   */
  addRule(session: AcpSessionState, rule: string): { success: boolean; rules: string[] } {
    if (rule && !session.persistentRules.includes(rule)) {
      session.persistentRules.push(rule);
    }
    return { success: true, rules: session.persistentRules };
  }

  /**
   * Intercepts and executes ACP tool calls internally without hitting upstream model
   */
  handleAcpToolCall(
    session: AcpSessionState,
    name: string,
    args: any
  ): { handled: boolean; result?: any } {
    switch (name) {
      case "compress": {
        const res = this.compressRange(session, args.from_id, args.to_id, args.summary);
        return { handled: true, result: res };
      }
      case "decompress": {
        const res = this.decompressBlock(session, args.block_id);
        return { handled: true, result: res };
      }
      case "search_context": {
        const res = this.searchContext(session, args.query);
        return { handled: true, result: { query: args.query, results: res } };
      }
      case "acp_status": {
        const res = this.getStatus(session);
        return { handled: true, result: res };
      }
      case "acp_rule": {
        const res = this.addRule(session, args.rule);
        return { handled: true, result: res };
      }
      default:
        return { handled: false };
    }
  }
}
