"""
skill_resolver: Resolve assistant skill_refs to ToolDefinition objects.

Given a list of skill_refs (e.g. [{"skill_id": "core.tools.crawler", "version": "latest"}]),
resolves each to SkillRegistry manifest tool definitions, ready for injection into the LLM tool list.
"""

import logging
from typing import Any

from app.schemas.tool import ToolDefinition

logger = logging.getLogger(__name__)

_LEGACY_SKILL_ID_ALIASES: dict[str, str] = {
    "core.tools.crawler": "official.skills.crawler",
    "core.tools.search": "official.skills.memory",
    "core.registry.provider": "official.skills.provider_registry",
    "system/database_manager": "official.skills.database",
    "system.code_interpreter": "official.skills.code_interpreter",
    "system.image_generation": "official.skills.image_generation",
    "system.planner": "official.skills.planner",
    "system.expert_network": "official.skills.expert_network",
    "system/monitor": "official.skills.monitor",
}


def _coerce_schema(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _candidate_skill_ids(skill_id: str) -> list[str]:
    raw = str(skill_id or "").strip()
    if not raw:
        return []

    normalized = raw.replace("/", ".")
    tail = normalized.split(".")[-1].strip()

    candidates = [
        raw,
        normalized,
        _LEGACY_SKILL_ID_ALIASES.get(raw),
        _LEGACY_SKILL_ID_ALIASES.get(normalized),
    ]
    if tail and not normalized.startswith("official.skills."):
        candidates.append(f"official.skills.{tail}")
        candidates.append(f"official.skills.{tail.replace('-', '_')}")

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        name = str(candidate or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        deduped.append(name)
    return deduped


async def resolve_skill_refs(
    skill_refs: list[dict[str, Any]],
) -> list[ToolDefinition]:
    """
    Resolve skill_refs to ToolDefinition objects by looking up each skill in SkillRegistry.

    Args:
        skill_refs: List of {"skill_id": "...", "version": "latest"} dicts

    Returns:
        List of ToolDefinition objects from the resolved skills
    """
    if not skill_refs:
        return []

    from app.core.database import AsyncSessionLocal
    from app.repositories.skill_registry_repository import SkillRegistryRepository

    tools: list[ToolDefinition] = []
    seen_names: set[str] = set()

    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)

        for ref in skill_refs:
            raw_skill_id = str((ref or {}).get("skill_id") or "").strip()
            if not raw_skill_id:
                continue

            skill = None
            for candidate_id in _candidate_skill_ids(raw_skill_id):
                skill = await repo.get_by_id(candidate_id)
                if skill:
                    break

            if not skill:
                logger.warning(
                    "skill_resolver: Skill '%s' not found in SkillRegistry", raw_skill_id
                )
                continue

            manifest = skill.manifest_json if isinstance(skill.manifest_json, dict) else {}
            raw_tools = manifest.get("tools", [])
            if not isinstance(raw_tools, list):
                continue

            for tool_def in raw_tools:
                if not isinstance(tool_def, dict):
                    continue
                name = str(tool_def.get("name") or "").strip()
                if not name or name in seen_names:
                    continue
                seen_names.add(name)
                tools.append(
                    ToolDefinition(
                        name=name,
                        description=str(tool_def.get("description") or ""),
                        input_schema=_coerce_schema(
                            tool_def.get("parameters") or tool_def.get("input_schema")
                        ),
                        output_schema=_coerce_schema(tool_def.get("output_schema")),
                        output_description=tool_def.get("output_description"),
                        extra_meta={
                            "origin": "skill",
                            "skill_id": str(skill.id),
                            "runtime": str(getattr(skill, "runtime", "") or "").strip().lower(),
                        },
                    )
                )

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
