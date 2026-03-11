from typing import Any

async def invoke(tool_name: str, args: dict[str, Any], deeting: Any) -> Any:
    """
    Primary backend entrypoint for the skill/plugin.

    :param tool_name: Tool selected by the host. Keep it aligned with SKILL.md
        and, when present, llm-tool.yaml.
    :param args: Arguments passed to the selected tool.
    :param deeting: Deeting SDK object with call_tool, render, log, and related helpers.
    """
    deeting.log(f"Executing tool: {tool_name} with args: {args}")
    
    if tool_name == "hello_deeting":
        name = args.get("name", "Stranger")
        message = f"Hello {name}! This is your custom plugin speaking."
        
        # Optional UI block
        deeting.render(
            view_type="bento.grid",
            title="Plugin Response",
            payload={
                "items": [
                    {"title": "Status", "value": "Active", "color": "emerald"},
                    {"title": "User", "value": name}
                ]
            }
        )
        
        return {"message": message}
    
    raise ValueError(f"Unknown tool: {tool_name}")
