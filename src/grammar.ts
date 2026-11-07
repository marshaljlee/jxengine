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
export function jsonSchemaToGbnf(schema: any, rootRule = "root"): string {
  const rules: string[] = [];

  function buildRule(s: any, name: string): string {
    if (!s || typeof s !== "object") {
      return `${name} ::= value`;
    }

    if (s.enum && Array.isArray(s.enum) && s.enum.length > 0) {
      const enumVals = s.enum.map((v: any) => JSON.stringify(v)).join(" | ");
      return `${name} ::= ${enumVals}`;
    }

    const type = s.type || "object";

    switch (type) {
      case "string":
        return `${name} ::= string`;
      case "number":
      case "integer":
        return `${name} ::= number`;
      case "boolean":
        return `${name} ::= boolean`;
      case "array": {
        const itemRule = `${name}-item`;
        const itemDef = buildRule(s.items || {}, itemRule);
        rules.push(itemDef);
        return `${name} ::= "[" ws ( ${itemRule} ( ws "," ws ${itemRule} )* )? ws "]"`;
      }
      case "object": {
        const props = s.properties || {};
        const required = new Set(s.required || []);
        const propKeys = Object.keys(props);

        if (propKeys.length === 0) {
          return `${name} ::= "{" ws "}"`;
        }

        const propRules: string[] = [];
        for (const key of propKeys) {
          const propRuleName = `${name}-${key.replace(/[^a-zA-Z0-9_]/g, "_")}`;
          const propValDef = buildRule(props[key], propRuleName);
          rules.push(propValDef);

          const isReq = required.has(key);
          const propLine = `\\"\" ${JSON.stringify(key).slice(1, -1)} \\"\" ws ":" ws ${propRuleName}`;
          propRules.push(isReq ? propLine : `( ${propLine} )?`);
        }

        // Generic object formatting
        return `${name} ::= "{" ws ( ${propRules.join(' ws "," ws ')} ) ws "}"`;
      }
      default:
        return `${name} ::= value`;
    }
  }

  const rootDef = buildRule(schema, rootRule);
  rules.unshift(rootDef);

  const primitives = `
root ::= ${rootRule}
value ::= object | array | string | number | boolean | null
object ::= "{" ws ( string ws ":" ws value ( ws "," ws string ws ":" ws value )* )? ws "}"
array ::= "[" ws ( value ( ws "," ws value )* )? ws "]"
string ::= "\\"" ([^"\\\\] | "\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]))* "\\""
number ::= ("-"? ([0-9] | [1-9] [0-9]*)) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?
boolean ::= "true" | "false"
null ::= "null"
ws ::= [ \\t\\n\\r]*
`.trim();

  return `${rules.join("\n")}\n\n${primitives}`;
}

/**
 * Builds a GBNF grammar that forces the model to choose one of the available tool functions,
 * ensuring clean structured output for agentic function calling.
 */
export function buildToolCallingGbnf(tools: ToolDefinition[]): string {
  if (!tools || tools.length === 0) return "";

  const toolRules: string[] = [];

  for (let i = 0; i < tools.length; i++) {
    const fn = tools[i].function;
    const ruleName = `tool_${fn.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const params = fn.parameters || { type: "object", properties: {} };
    const paramGbnf = jsonSchemaToGbnf(params, `${ruleName}_params`);

    toolRules.push(`
${ruleName} ::= "{" ws "\\"name\\"" ws ":" ws "\\"${fn.name}\\"" ws "," ws "\\"arguments\\"" ws ":" ws ${ruleName}_params ws "}"
${paramGbnf}
`.trim());
  }

  const toolChoices = tools.map((t) => `tool_${t.function.name.replace(/[^a-zA-Z0-9_]/g, "_")}`).join(" | ");

  return `
root ::= ${toolChoices}
ws ::= [ \\t\\n\\r]*
`.trim() + "\n\n" + toolRules.join("\n\n");
}

