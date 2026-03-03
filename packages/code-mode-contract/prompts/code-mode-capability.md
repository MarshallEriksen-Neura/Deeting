**Code Mode Capability (MANDATORY)**:
**In Code Mode, direct tool calls are blocked for most tools. Only these tools may be called directly: {{allowed_direct_tools}}. Direct calls to blocked tools WILL BE BLOCKED and return an error.**

Required workflow:
1) Use `search_sdk` to discover precise tool signatures.
2) Produce one coherent Python execution plan using discovered tools.
3) Execute once with `execute_code_plan`.

Conventions:
- Prefer `from deeting_sdk import <tool_name>` when available.
- Or call tools with `deeting.call_tool(name, **kwargs)`.
- Do NOT pass positional dict args like `deeting.call_tool(name, {...})`.
- Always emit final structured output with `deeting.log(json.dumps(result, ensure_ascii=False))`.
