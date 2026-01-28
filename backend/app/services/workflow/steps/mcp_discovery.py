import logging
import time
from typing import TYPE_CHECKING

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus
from app.services.tools.tool_context_service import extract_last_user_message, tool_context_service

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
        final_tools = []
        start_time = time.perf_counter()
        trace_id = getattr(ctx, "trace_id", None)
        logger.info(
            "McpDiscoveryStep: start trace_id=%s user_id=%s has_db_session=%s",
            trace_id,
            user_id,
            bool(ctx.db_session),
        )

        query = ""
        conv_msgs = ctx.get("conversation", "merged_messages")
        if isinstance(conv_msgs, list) and conv_msgs:
            query = extract_last_user_message(conv_msgs)

        if not query:
            req = ctx.get("validation", "request")
            if req and getattr(req, "messages", None):
                query = extract_last_user_message([m.model_dump() for m in req.messages])

        try:
            build_start = time.perf_counter()
            final_tools = await tool_context_service.build_tools(
                session=ctx.db_session,
                user_id=user_id,
                query=query,
            )
            logger.info(
                "McpDiscoveryStep: build_tools done trace_id=%s duration_ms=%.2f tools=%s query_len=%s",
                trace_id,
                (time.perf_counter() - build_start) * 1000,
                len(final_tools),
                len(query or ""),
            )
        except Exception as e:
            logger.exception(
                "McpDiscoveryStep: tool discovery failed trace_id=%s error=%s",
                trace_id,
                e,
            )

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
        
        logger.info(
            "McpDiscoveryStep: end trace_id=%s duration_ms=%.2f",
            trace_id,
            (time.perf_counter() - start_time) * 1000,
        )
        return StepResult(
            status=StepStatus.SUCCESS,
            data={"count": len(final_tools)}
        )
