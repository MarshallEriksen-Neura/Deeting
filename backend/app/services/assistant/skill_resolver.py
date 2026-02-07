"""
skill_resolver: Resolve assistant skill_refs to ToolDefinition objects.

Given a list of skill_refs (e.g. [{"skill_id": "core.tools.crawler", "version": "latest"}]),
resolves each to the plugin's tool definitions, ready for injection into the LLM tool list.
"""

import logging
from typing import Any

from app.schemas.tool import ToolDefinition

logger = logging.getLogger(__name__)


async def resolve_skill_refs(
    skill_refs: list[dict[str, Any]],
) -> list[ToolDefinition]:
    """
    Resolve skill_refs to ToolDefinition objects by looking up each plugin.

    Args:
        skill_refs: List of {"skill_id": "plugin.name", "version": "latest"} dicts

    Returns:
        List of ToolDefinition objects from the resolved plugins
    """
    if not skill_refs:
        return []

    from app.services.agent.agent_service import agent_service

    tools: list[ToolDefinition] = []
    seen_names: set[str] = set()

    for ref in skill_refs:
        skill_id = ref.get("skill_id")
        if not skill_id:
            continue

        plugin = agent_service.plugin_manager.get_plugin(skill_id)
        if not plugin:
            logger.warning(f"skill_resolver: Plugin '{skill_id}' not found in active plugins")
            continue

        try:
            raw_tools = plugin.get_tools() or []
            for tool_def in raw_tools:
                func_def = tool_def.get("function", {})
                name = func_def.get("name")
                if not name or name in seen_names:
                    continue
                seen_names.add(name)
                tools.append(
                    ToolDefinition(
                        name=name,
                        description=func_def.get("description"),
                        input_schema=func_def.get("parameters", {}),
                    )
                )
        except Exception as e:
            logger.warning(f"skill_resolver: Failed to get tools from '{skill_id}': {e}")

    logger.info(f"skill_resolver: Resolved {len(tools)} tools from {len(skill_refs)} skill_refs")
    return tools


def skill_tools_to_openai_format(tools: list[ToolDefinition]) -> list[dict[str, Any]]:
    """
    Convert ToolDefinition objects to OpenAI function calling format.

    Args:
        tools: List of ToolDefinition objects

    Returns:
        List of {"type": "function", "function": {...}} dicts
    """
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description or "",
                "parameters": t.input_schema,
            },
        }
        for t in tools
    ]
