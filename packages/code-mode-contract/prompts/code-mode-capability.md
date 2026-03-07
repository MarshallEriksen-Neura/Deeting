**Code Mode Capability (MANDATORY)**:
**In Code Mode, direct tool calls are blocked for most tools. Only these tools may be called directly: {{allowed_direct_tools}}. Direct calls to blocked tools WILL BE BLOCKED and return an error.**

Required workflow:
1) If an expert persona may help, call `consult_expert_network` to inspect candidates.
2) Explicitly call `activate_assistant` before switching persona context.
3) Use `search_sdk` to discover precise tool signatures.
4) Produce one coherent Python execution plan using discovered tools.
5) Execute once with `execute_code_plan`.

Conventions:
- Prefer `from deeting_sdk import <tool_name>` when available.
- Or call tools with `deeting.call_tool(name, **kwargs)`.
- Do NOT pass positional dict args like `deeting.call_tool(name, {...})`.
- Use `deactivate_assistant` to return to the default assistant context.
- Always emit final structured output with `deeting.log(json.dumps(result, ensure_ascii=False))`.
