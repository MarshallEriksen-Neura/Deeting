import logging
from typing import TYPE_CHECKING

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus
from app.schemas.tool import ToolDefinition

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)

@step_registry.register
class McpDiscoveryStep(BaseStep):
    """
    MCP Discovery Step.
    
    Responsibilities:
    - Identify the current user.
    - Fetch active MCP tools from UserMcpServer cache.
    - Inject tools into the workflow context for the LLM.
    """

    name = "mcp_discovery"
    # This should run after validation (to have user_id) 
    # but before routing/template_render (to inject tools into the LLM request)
    depends_on = ["validation"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        user_id = ctx.user_id

        final_tools: list = []
        core_tools: list = []
        non_core_system_tools: list = []
        user_tool_payloads: list[dict] = []

        query = ""
        conv_msgs = ctx.get("conversation", "merged_messages")
        if isinstance(conv_msgs, list) and conv_msgs:
            for msg in reversed(conv_msgs):
                if msg.get("role") == "user":
                    query = msg.get("content", "")
                    break

        if not query:
            req = ctx.get("validation", "request")
            if req and getattr(req, "messages", None):
                for msg in reversed(req.messages):
                    if getattr(msg, "role", None) == "user":
                        query = getattr(msg, "content", "")
                        break

        try:
            from app.core.config import settings
            from app.core.plugin_config import plugin_config_loader
            from app.qdrant_client import qdrant_is_configured
            from app.services.agent import agent_service
            from app.services.mcp.discovery import mcp_discovery_service
            from app.services.tools.tool_sync_service import tool_sync_service

            await agent_service.initialize()

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

            if user_id and ctx.db_session:
                user_tool_payloads = await mcp_discovery_service.get_active_tool_payloads(
                    ctx.db_session,
                    user_id,
                )

            total_tool_count = len(system_tools) + len(user_tool_payloads)
            threshold = int(getattr(settings, "MCP_TOOL_JIT_THRESHOLD", 15) or 15)

            use_jit = bool(qdrant_is_configured()) and total_tool_count > threshold and bool(query)

            if use_jit:
                dynamic_hits = await tool_sync_service.search_tools(query, user_id)
                final_tools.extend(core_tools)
                existing_names = {t.name for t in final_tools}
                for tool in dynamic_hits:
                    if tool.name in existing_names:
                        continue
                    final_tools.append(tool)
                    existing_names.add(tool.name)
            else:
                final_tools.extend(core_tools)
                existing_names = {t.name for t in final_tools}
                for payload in user_tool_payloads:
                    name = payload.get("name")
                    if name and name not in existing_names:
                        final_tools.append(ToolDefinition(**payload))
                        existing_names.add(name)
                for tool in non_core_system_tools:
                    if tool.name not in existing_names:
                        final_tools.append(tool)
                        existing_names.add(tool.name)
        except Exception as e:
            logger.error(f"MCP tool discovery failed: {e}")

        if final_tools:
            # 3. Inject into context
            ctx.set("mcp_discovery", "tools", final_tools)
            
            logger.debug(f"McpDiscoveryStep: Injected {len(final_tools)} tools (Core + Dynamic)")
            
            ctx.emit_status(
                stage="discovery",
                step=self.name,
                state="success",
                code="mcp.tools.discovered",
                meta={"count": len(final_tools)}
            )
        
        return StepResult(
            status=StepStatus.SUCCESS,
            data={"count": len(final_tools)}
        )
