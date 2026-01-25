import logging
from typing import TYPE_CHECKING

from app.services.mcp.discovery import mcp_discovery_service
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

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
        
        # Initialize tool list
        final_tools = []

        # 1. Fetch User MCP Tools (if user exists)
        if user_id:
            try:
                user_tools = await mcp_discovery_service.get_active_tools(ctx.db_session, user_id)
                final_tools.extend(user_tools)
            except Exception as e:
                logger.error(f"User MCP discovery failed: {e}")

        # 2. Fetch System/Builtin Tools (Native Plugins)
        # We filter based on the configuration (plugins.yaml)
        try:
            from app.services.agent_service import agent_service
            from app.core.plugin_config import plugin_config_loader
            
            # Ensure initialized
            await agent_service.initialize()
            
            system_tools = agent_service.tools
            
            # Build whitelist from config
            # Only include tools from plugins that are 'enabled_by_default'
            # In the future, this can be expanded to check user-specific installation/permissions
            enabled_plugins = plugin_config_loader.get_enabled_plugins()
            
            allowed_tool_names = set()
            for p in enabled_plugins:
                allowed_tool_names.update(p.tools)
            
            for tool in system_tools:
                if tool.name in allowed_tool_names:
                    final_tools.append(tool)
                    
        except Exception as e:
            logger.error(f"System tool discovery failed: {e}")

        if final_tools:
            # 3. Inject into context
            ctx.set("mcp_discovery", "tools", final_tools)
            
            logger.debug(f"McpDiscoveryStep: Injected {len(final_tools)} tools (User+System)")
            
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
