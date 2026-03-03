from __future__ import annotations

from pathlib import Path

_DEFAULT_CODE_MODE_CAPABILITY_PROMPT = (
    "**Code Mode Capability (MANDATORY)**:\n"
    "**In Code Mode, direct tool calls are blocked for most tools. "
    "Only these tools may be called directly: {{allowed_direct_tools}}. "
    "Direct calls to blocked tools WILL BE BLOCKED and return an error.**\n\n"
    "Required workflow:\n"
    "1) Use `search_sdk` to discover precise tool signatures.\n"
    "2) Produce one coherent Python execution plan using discovered tools.\n"
    "3) Execute once with `execute_code_plan`.\n\n"
    "Conventions:\n"
    "- Prefer `from deeting_sdk import <tool_name>` when available.\n"
    "- Or call tools with `deeting.call_tool(name, **kwargs)`.\n"
    "- Do NOT pass positional dict args like `deeting.call_tool(name, {...})`.\n"
    "- Always emit final structured output with `deeting.log(json.dumps(result, ensure_ascii=False))`.\n"
)


def _load_code_mode_capability_template() -> str:
    template_path = (
        Path(__file__).resolve().parents[4]
        / "packages"
        / "code-mode-contract"
        / "prompts"
        / "code-mode-capability.md"
    )
    try:
        content = template_path.read_text(encoding="utf-8").strip()
    except Exception:
        return _DEFAULT_CODE_MODE_CAPABILITY_PROMPT
    return content or _DEFAULT_CODE_MODE_CAPABILITY_PROMPT


_CODE_MODE_CAPABILITY_TEMPLATE = _load_code_mode_capability_template()


def render_code_mode_capability_prompt(allowed_direct_tools: str) -> str:
    replacement = (allowed_direct_tools or "`search_sdk`, `execute_code_plan`").strip()
    rendered = _CODE_MODE_CAPABILITY_TEMPLATE.replace("{{allowed_direct_tools}}", replacement)
    return rendered.strip()
