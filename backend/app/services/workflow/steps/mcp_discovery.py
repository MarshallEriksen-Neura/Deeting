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
        if not user_id:
            # Skip if no user context (e.g. public anonymous chat if allowed)
            return StepResult(status=StepStatus.SUCCESS)

        try:
            # 1. Fetch tools from cache
            tools = await mcp_discovery_service.get_active_tools(ctx.db_session, user_id)
            
            if tools:
                # 2. Inject into context
                # The RequestRenderer and LLMService will look for 'tools' in the context
                # or we can append to an existing list.
                existing_tools = ctx.get("mcp_discovery", "tools") or []
                existing_tools.extend(tools)
                ctx.set("mcp_discovery", "tools", existing_tools)
                
                logger.debug(f"McpDiscoveryStep: Injected {len(tools)} tools for user {user_id}")
                
                ctx.emit_status(
                    stage="discovery",
                    step=self.name,
                    state="success",
                    code="mcp.tools.discovered",
                    meta={"count": len(tools)}
                )
            
            return StepResult(
                status=StepStatus.SUCCESS,
                data={"count": len(tools)}
            )

        except Exception as e:
            logger.error(f"McpDiscoveryStep failed: {e}")
            # We don't want to break the whole chat if MCP discovery fails
            return StepResult(status=StepStatus.SUCCESS, message=f"MCP discovery skipped: {str(e)}")
