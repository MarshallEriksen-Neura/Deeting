import logging
import time
import uuid
from collections.abc import Iterable

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
        user_id: str | uuid.UUID | None,
        query: str | None,
    ) -> list[ToolDefinition]:
        from app.services.agent.agent_service import agent_service

        # Normalize user_id to UUID if provided as string
        uid = None
        if user_id:
            try:
                uid = uuid.UUID(str(user_id)) if not isinstance(user_id, uuid.UUID) else user_id
            except (ValueError, AttributeError):
                uid = None

        start_time = time.perf_counter()
        logger.info(
            "ToolContextService: start user_id=%s has_session=%s query_len=%s",
            uid,
            bool(session),
            len(query or ""),
        )

        if uid is None:
            logger.warning(
                "ToolContextService: skip tool build due to missing real user_id"
            )
            return []

        init_start = time.perf_counter()
        await agent_service.initialize(user_id=uid)
        logger.info(
            "ToolContextService: agent initialized duration_ms=%.2f tools=%s",
            (time.perf_counter() - init_start) * 1000,
            len(agent_service.tools),
        )

        # 获取用户角色信息（用于受限插件过滤）
        user_roles: set[str] = set()
        is_superuser = False
        if uid and session:
            from app.repositories import UserRepository

            try:
                user_repo = UserRepository(session)
                user_obj = await user_repo.get_user_with_roles(uid)
                if user_obj:
                    is_superuser = user_obj.is_superuser
                    user_roles = {r.name for r in user_obj.roles}
            except Exception:
                logger.warning(
                    "ToolContextService: failed to fetch user roles user_id=%s",
                    uid,
                    exc_info=True,
                )

        enabled_plugins = plugin_config_loader.get_plugins_for_user(
            user_roles, is_superuser
        )
        allowed_tool_names = set()
        core_tool_names = set()
        skill_runner_enabled = False
        for plugin in enabled_plugins:
            allowed_tool_names.update(plugin.tools or [])
            if plugin.is_always_on:
                core_tool_names.update(plugin.tools or [])
            if plugin.id == "core.execution.skill_runner":
                skill_runner_enabled = True

        system_tools = [
            tool for tool in agent_service.tools if tool.name in allowed_tool_names
        ]
        core_tools = [tool for tool in system_tools if tool.name in core_tool_names]
        non_core_system_tools = [
            tool for tool in system_tools if tool.name not in core_tool_names
        ]
        code_mode_enabled = {"search_sdk", "execute_code_plan"}.issubset(
            allowed_tool_names
        )
        code_mode_minimal_toolset = bool(
            getattr(settings, "CODE_MODE_MINIMAL_TOOLSET", False)
        )

        user_tool_payloads: list[dict] = []
        user_mcp_tool_names: set[str] = set()
        if uid and session:
            payload_start = time.perf_counter()
            user_tool_payloads = await mcp_discovery_service.get_active_tool_payloads(
                session, uid
            )
            user_mcp_tool_names = {
                str(payload.get("name") or "").strip()
                for payload in user_tool_payloads
                if payload.get("name")
            }
            logger.info(
                "ToolContextService: loaded user tools duration_ms=%.2f count=%s",
                (time.perf_counter() - payload_start) * 1000,
                len(user_tool_payloads),
            )

        total_tool_count = len(system_tools) + len(user_tool_payloads)
        threshold = int(getattr(settings, "MCP_TOOL_JIT_THRESHOLD", 15) or 15)
        # 强制开启 JIT 的条件：Qdrant 已配置 + 有查询 + (工具多 OR 启用了动态技能运行器)
        use_jit = (
            bool(qdrant_is_configured())
            and (total_tool_count > threshold or skill_runner_enabled)
            and bool(query)
        )
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
            dynamic_hits = await tool_sync_service.search_tools(query or "", uid)
            logger.info(
                "ToolContextService: JIT search duration_ms=%.2f hits=%s",
                (time.perf_counter() - jit_start) * 1000,
                len(dynamic_hits),
            )
            # 1. 添加核心工具 (Always On)
            for tool in core_tools:
                if tool.name in existing_names:
                    continue
                final_tools.append(tool)
                existing_names.add(tool.name)
            
            # 2. 添加 JIT 命中的动态技能
            # code mode 最小工具集模式下，跳过用户 MCP 工具（只能通过 execute_code_plan 间接调用）
            skip_user_mcp = code_mode_enabled and code_mode_minimal_toolset
            for tool in dynamic_hits:
                if tool.name in existing_names:
                    continue
                # code mode 下过滤掉用户 MCP 工具，避免 LLM 直接调用被阻拦浪费一轮
                if skip_user_mcp and tool.name in user_mcp_tool_names:
                    continue
                # skill__ 动态技能必须依赖 skill_runner；否则只允许白名单系统工具
                if (
                    (tool.name.startswith("skill__") and skill_runner_enabled)
                    or tool.name in allowed_tool_names
                    or tool.name in user_mcp_tool_names
                ):
                    final_tools.append(tool)
                    existing_names.add(tool.name)

            # 3. 补充添加所有已启用的内置系统工具 (确保爬虫等基础能力不丢失)
            if not (code_mode_enabled and code_mode_minimal_toolset):
                for tool in non_core_system_tools:
                    if tool.name in existing_names:
                        continue
                    final_tools.append(tool)
                    existing_names.add(tool.name)
            else:
                logger.info(
                    "ToolContextService: code mode minimal toolset enabled, skip non-core system tools"
                )

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

        # code mode 最小工具集模式下，跳过用户 MCP 工具（只能通过 execute_code_plan 间接调用）
        skip_user_mcp = code_mode_enabled and code_mode_minimal_toolset
        if not skip_user_mcp:
            for payload in user_tool_payloads:
                name = payload.get("name")
                if not name or name in existing_names:
                    continue
                try:
                    final_tools.append(ToolDefinition(**payload))
                    existing_names.add(name)
                except Exception:
                    continue
        else:
            logger.info(
                "ToolContextService: code mode minimal toolset enabled, skip user MCP tools"
            )

        if not (code_mode_enabled and code_mode_minimal_toolset):
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
