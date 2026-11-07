import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
/**
 * Production-ready Jinja2 chat templates with tool/agent calling support
 * Derived from llama.cpp / llama-server official reference templates.
 */
export const TEMPLATES = {
    chatml: `{%- if tools %}
    {{- '<|im_start|>system\\n' }}
    {%- if messages[0]['role'] == 'system' %}
        {{- messages[0]['content'] }}
    {%- else %}
        {{- 'You are a helpful assistant with tool-calling capabilities.' }}
    {%- endif %}
    {{- '\\n\\n# Tools\\n\\nYou have access to the following functions:\\n\\n' }}
    {%- for tool in tools %}
        {{- 'Use the function \`' ~ tool.function.name ~ '\` to: ' ~ tool.function.description ~ '\\n' }}
        {{- 'JSON Schema:\\n' }}
        {{- tool.function | tojson }}
        {{- '\\n\\n' }}
    {%- endfor %}
    {{- 'To call a function, respond with a JSON object inside <tool_call></tool_call> tags:\\n' }}
    {{- '<tool_call>\\n{"name": "function_name", "arguments": {"arg_1": "val_1"}}\\n</tool_call>\\n' }}
    {{- '<|im_end|>\\n' }}
{%- else %}
    {%- if messages[0]['role'] == 'system' %}
        {{- '<|im_start|>system\\n' ~ messages[0]['content'] ~ '<|im_end|>\\n' }}
    {%- endif %}
{%- endif %}
{%- for message in messages %}
    {%- if message.role == 'user' %}
        {{- '<|im_start|>user\\n' ~ message.content ~ '<|im_end|>\\n' }}
    {%- elif message.role == 'assistant' %}
        {{- '<|im_start|>assistant\\n' }}
        {%- if message.content %}
            {{- message.content }}
        {%- endif %}
        {%- if message.tool_calls %}
            {%- for tool_call in message.tool_calls %}
                {{- '<tool_call>\\n{"name": "' ~ tool_call.function.name ~ '", "arguments": ' ~ tool_call.function.arguments | tojson ~ '}\\n</tool_call>\\n' }}
            {%- endfor %}
        {%- endif %}
        {{- '<|im_end|>\\n' }}
    {%- elif message.role == 'tool' %}
        {{- '<|im_start|>user\\n<tool_response>\\n' ~ message.content ~ '\\n</tool_response><|im_end|>\\n' }}
    {%- endif %}
{%- endfor %}
{%- if add_generation_prompt %}
    {{- '<|im_start|>assistant\\n' }}
{%- endif %}`,
    llama3: `{{- '<|begin_of_text|>' }}
{%- if tools %}
    {{- '<|start_header_id|>system<|end_header_id|>\\n\\n' }}
    {%- if messages[0]['role'] == 'system' %}
        {{- messages[0]['content'] }}
    {%- else %}
        {{- 'You are a helpful assistant with tool-calling capabilities.' }}
    {%- endif %}
    {{- '\\n\\nEnvironment: ipython\\n\\nTools:\\n' }}
    {%- for tool in tools %}
        {{- tool.function | tojson ~ '\\n' }}
    {%- endfor %}
    {{- '\\nTo call a tool, output the function call JSON.\\n' }}
    {{- '<|eot_id|>' }}
{%- else %}
    {%- if messages[0]['role'] == 'system' %}
        {{- '<|start_header_id|>system<|end_header_id|>\\n\\n' ~ messages[0]['content'] ~ '<|eot_id|>' }}
    {%- endif %}
{%- endif %}
{%- for message in messages %}
    {%- if message.role == 'user' %}
        {{- '<|start_header_id|>user<|end_header_id|>\\n\\n' ~ message.content ~ '<|eot_id|>' }}
    {%- elif message.role == 'assistant' %}
        {{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' }}
        {%- if message.content %}
            {{- message.content }}
        {%- endif %}
        {%- if message.tool_calls %}
            {%- for tool_call in message.tool_calls %}
                {{- '{"name": "' ~ tool_call.function.name ~ '", "parameters": ' ~ tool_call.function.arguments | tojson ~ '}' }}
            {%- endfor %}
        {%- endif %}
        {{- '<|eot_id|>' }}
    {%- elif message.role == 'tool' %}
        {{- '<|start_header_id|>ipython<|end_header_id|>\\n\\n' ~ message.content ~ '<|eot_id|>' }}
    {%- endif %}
{%- endfor %}
{%- if add_generation_prompt %}
    {{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' }}
{%- endif %}`,
    deepseek: `{%- if tools %}
    {%- if messages[0]['role'] == 'system' %}
        {{- messages[0]['content'] + '\\n\\n' }}
    {%- endif %}
    {{- '# Tools\\n\\nYou have access to the following tools:\\n\\n' }}
    {%- for tool in tools %}
        {{- '\`\`\`json\\n' ~ tool.function | tojson ~ '\\n\`\`\`\\n\\n' }}
    {%- endfor %}
    {{- 'To call a function, respond with: <tool_call>\\n{"name": "function_name", "arguments": {}}\\n</tool_call>\\n\\n' }}
{%- else %}
    {%- if messages[0]['role'] == 'system' %}
        {{- messages[0]['content'] + '\\n\\n' }}
    {%- endif %}
{%- endif %}
{%- for message in messages %}
    {%- if message.role == 'user' %}
        {{- '<｜User｜>' + message.content }}
    {%- elif message.role == 'assistant' %}
        {{- '<｜Assistant｜>' }}
        {%- if message.content %}
            {{- message.content }}
        {%- endif %}
        {%- if message.tool_calls %}
            {%- for tool_call in message.tool_calls %}
                {{- '<tool_call>\\n{"name": "' ~ tool_call.function.name ~ '", "arguments": ' ~ tool_call.function.arguments | tojson ~ '}\\n</tool_call>' }}
            {%- endfor %}
        {%- endif %}
    {%- elif message.role == 'tool' %}
        {{- '<｜User｜><tool_response>\\n' + message.content + '\\n</tool_response>' }}
    {%- endif %}
{%- endfor %}
{%- if add_generation_prompt %}
    {{- '<｜Assistant｜>' }}
{%- endif %}`,
};
export function getJinjaTemplateFile(family = "chatml") {
    const code = TEMPLATES[family] || TEMPLATES.chatml;
    const dir = join(tmpdir(), "jxengine-templates");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${family}.jinja`);
    writeFileSync(target, code, "utf8");
    return target;
}
//# sourceMappingURL=templates.js.map