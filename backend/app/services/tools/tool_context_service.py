import logging
import time
from typing import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.plugin_config import plugin_config_loader
from app.qdrant_client import qdrant_is_configured
from app.schemas.tool import ToolDefinition
from app.services.mcp.discovery import mcp_discovery_service
from app.services.tools.tool_sync_service import tool_sync_service

logger = logging.getLogger(__name__)


def extract_last_user_message(messages: Iterable[dict] | None) -> str:
    if not messages:
        return ""
    for message in reversed(list(messages)):
        if isinstance(message, dict) and message.get("role") == "user":
            return str(message.get("content") or "").strip()
    return ""


class ToolContextService:
    async def build_tools(
        self,
        *,
        session: AsyncSession | None,
        user_id,
        query: str | None,
    ) -> list[ToolDefinition]:
        from app.services.agent.agent_service import agent_service

        start_time = time.perf_counter()
        logger.info(
            "ToolContextService: start user_id=%s has_session=%s query_len=%s",
            user_id,
            bool(session),
            len(query or ""),
        )

        init_start = time.perf_counter()
        await agent_service.initialize()
        logger.info(
            "ToolContextService: agent initialized duration_ms=%.2f tools=%s",
            (time.perf_counter() - init_start) * 1000,
            len(agent_service.tools),
        )

        enabled_plugins = plugin_config_loader.get_enabled_plugins()
        allowed_tool_names = set()
        core_tool_names = set()
        for plugin in enabled_plugins:
            allowed_tool_names.update(plugin.tools or [])
            if plugin.is_always_on:
                core_tool_names.update(plugin.tools or [])

        system_tools = [tool for tool in agent_service.tools if tool.name in allowed_tool_names]
        core_tools = [tool for tool in system_tools if tool.name in core_tool_names]
        non_core_system_tools = [tool for tool in system_tools if tool.name not in core_tool_names]

        user_tool_payloads: list[dict] = []
        if user_id and session:
            payload_start = time.perf_counter()
            user_tool_payloads = await mcp_discovery_service.get_active_tool_payloads(session, user_id)
            logger.info(
                "ToolContextService: loaded user tools duration_ms=%.2f count=%s",
                (time.perf_counter() - payload_start) * 1000,
                len(user_tool_payloads),
            )

        total_tool_count = len(system_tools) + len(user_tool_payloads)
        threshold = int(getattr(settings, "MCP_TOOL_JIT_THRESHOLD", 15) or 15)
        use_jit = bool(qdrant_is_configured()) and total_tool_count > threshold and bool(query)
        logger.info(
            "ToolContextService: tool counts system=%s user=%s total=%s threshold=%s use_jit=%s qdrant=%s",
            len(system_tools),
            len(user_tool_payloads),
            total_tool_count,
            threshold,
            use_jit,
            bool(qdrant_is_configured()),
        )

        final_tools: list[ToolDefinition] = []
        existing_names: set[str] = set()

        if use_jit:
            jit_start = time.perf_counter()
            dynamic_hits = await tool_sync_service.search_tools(query or "", user_id)
            logger.info(
                "ToolContextService: JIT search duration_ms=%.2f hits=%s",
                (time.perf_counter() - jit_start) * 1000,
                len(dynamic_hits),
            )
            for tool in core_tools:
                if tool.name in existing_names:
                    continue
                final_tools.append(tool)
                existing_names.add(tool.name)
            for tool in dynamic_hits:
                if tool.name in existing_names:
                    continue
                final_tools.append(tool)
                existing_names.add(tool.name)
            logger.info(
                "ToolContextService: done duration_ms=%.2f final_tools=%s",
                (time.perf_counter() - start_time) * 1000,
                len(final_tools),
            )
            return final_tools

        for tool in core_tools:
            if tool.name in existing_names:
                continue
            final_tools.append(tool)
            existing_names.add(tool.name)

        for payload in user_tool_payloads:
            name = payload.get("name")
            if not name or name in existing_names:
                continue
            try:
                final_tools.append(ToolDefinition(**payload))
                existing_names.add(name)
            except Exception:
                continue

        for tool in non_core_system_tools:
            if tool.name in existing_names:
                continue
            final_tools.append(tool)
            existing_names.add(tool.name)

        logger.info(
            "ToolContextService: done duration_ms=%.2f final_tools=%s",
            (time.perf_counter() - start_time) * 1000,
            len(final_tools),
        )
        return final_tools


tool_context_service = ToolContextService()
