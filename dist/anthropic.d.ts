export interface AnthropicMessage {
    role: "user" | "assistant";
    content: string | Array<{
        type: string;
        text?: string;
        [key: string]: any;
    }>;
}
export interface AnthropicRequest {
    model: string;
    messages: AnthropicMessage[];
    system?: string;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stream?: boolean;
    tools?: any[];
}
export declare function anthropicToOpenAi(req: AnthropicRequest): Record<string, any>;
export declare function openAiToAnthropic(res: Record<string, any>, modelName: string): Record<string, any>;
//# sourceMappingURL=anthropic.d.ts.map