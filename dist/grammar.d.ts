/**
 * GBNF (GGML BNF) Grammar Generator for JSON & Structured Tool Calls.
 *
 * Constrains llama-server token sampling to guarantee that tool invocations
 * and JSON outputs strictly adhere to the expected schema without syntax errors.
 */
export interface JsonSchemaProperty {
    type?: string;
    description?: string;
    enum?: string[];
    items?: JsonSchemaProperty;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
}
export interface ToolDefinition {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: {
            type: "object";
            properties?: Record<string, JsonSchemaProperty>;
            required?: string[];
        };
    };
}
/**
 * Converts a JSON Schema object into GBNF grammar rules.
 */
export declare function jsonSchemaToGbnf(schema: any, rootRule?: string): string;
/**
 * Builds a GBNF grammar that forces the model to choose one of the available tool functions,
 * ensuring clean structured output for agentic function calling.
 */
export declare function buildToolCallingGbnf(tools: ToolDefinition[]): string;
//# sourceMappingURL=grammar.d.ts.map