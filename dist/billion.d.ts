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
    id: string;
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
export declare const ACP_TOOLS_SCHEMA: ({
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                from_id: {
                    type: string;
                    description: string;
                };
                to_id: {
                    type: string;
                    description: string;
                };
                summary: {
                    type: string;
                    description: string;
                };
                block_id?: undefined;
                query?: undefined;
                rule?: undefined;
            };
            required: string[];
        };
    };
} | {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                block_id: {
                    type: string;
                    description: string;
                };
                from_id?: undefined;
                to_id?: undefined;
                summary?: undefined;
                query?: undefined;
                rule?: undefined;
            };
            required: string[];
        };
    };
} | {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                query: {
                    type: string;
                    description: string;
                };
                from_id?: undefined;
                to_id?: undefined;
                summary?: undefined;
                block_id?: undefined;
                rule?: undefined;
            };
            required: string[];
        };
    };
} | {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                from_id?: undefined;
                to_id?: undefined;
                summary?: undefined;
                block_id?: undefined;
                query?: undefined;
                rule?: undefined;
            };
            required?: undefined;
        };
    };
} | {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                rule: {
                    type: string;
                    description: string;
                };
                from_id?: undefined;
                to_id?: undefined;
                summary?: undefined;
                block_id?: undefined;
                query?: undefined;
            };
            required: string[];
        };
    };
})[];
export declare class BillionContextEngine {
    private sessions;
    getOrCreateSession(sessionId?: string): AcpSessionState;
    /**
     * Assigns incremental sequence IDs (<acp:m00001>) to messages for addressable compression.
     */
    tagMessages(messages: any[]): AcpMessage[];
    /**
     * Executes compress(from_id, to_id, summary)
     */
    compressRange(session: AcpSessionState, fromId: string, toId: string, summary: string): {
        success: boolean;
        blockId?: string;
        message: string;
    };
    /**
     * Executes decompress(block_id)
     */
    decompressBlock(session: AcpSessionState, blockId: string): {
        success: boolean;
        message: string;
        restoredCount?: number;
    };
    /**
     * Executes search_context(query)
     */
    searchContext(session: AcpSessionState, query: string): Array<{
        source: string;
        snippet: string;
    }>;
    /**
     * Executes acp_status()
     */
    getStatus(session: AcpSessionState): {
        totalMessages: number;
        compressedBlocksCount: number;
        blocks: Array<{
            blockId: string;
            range: string;
            tokensSaved: number;
        }>;
        persistentRules: string[];
        compressibleRange: {
            from: string;
            to: string;
        } | null;
    };
    /**
     * Executes acp_rule(rule)
     */
    addRule(session: AcpSessionState, rule: string): {
        success: boolean;
        rules: string[];
    };
    /**
     * Intercepts and executes ACP tool calls internally without hitting upstream model
     */
    handleAcpToolCall(session: AcpSessionState, name: string, args: any): {
        handled: boolean;
        result?: any;
    };
}
//# sourceMappingURL=billion.d.ts.map