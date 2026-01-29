import json
import logging
from copy import deepcopy
from typing import TYPE_CHECKING, Any, List

from app.services.mcp.client import mcp_client
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus
from app.services.workflow.steps.upstream_call import UpstreamCallStep
from app.schemas.tool import ToolCall

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)

@step_registry.register
class AgentExecutorStep(BaseStep):
    """
    Agent Executor Step.
    Handles the execution loop for Tool-enabled chats.
    """

    name = "agent_executor"
    depends_on = ["template_render"]

    def __init__(self, config=None):
        super().__init__(config)
        self.upstream_step = UpstreamCallStep(config)
        self.max_turns = 5

    def _emit_delta(self, ctx: "WorkflowContext", content: str) -> None:
        """Helper to emit text content delta to the client stream."""
        if not ctx.status_emitter or not content:
            return
        
        payload = {
            "choices": [{
                "index": 0,
                "delta": {
                    "content": content
                }
            }]
        }
        ctx.status_emitter(payload)

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        # 1. Get initial state
        raw_request_body = ctx.get("template_render", "request_body")
        if not raw_request_body:
            return StepResult(status=StepStatus.FAILED, message="Missing rendered request body")

        # Deep copy to avoid mutating the original context prematurely
        request_body = deepcopy(raw_request_body)
        
        # Remember original stream setting
        original_stream = request_body.get("stream", False)
        
        # We MUST use non-streaming for intermediate turns to parse tool calls
        request_body["stream"] = False

        # Maintain chat history locally for the loop
        messages = request_body.get("messages", [])
        
        turn = 0
        last_step_result = None

        while turn < self.max_turns:
            turn += 1
            logger.info(f"AgentExecutor turn {turn} for trace_id {ctx.trace_id}")
            
            # Update request body with current history
            request_body["messages"] = messages
            ctx.set("template_render", "request_body", request_body)

            # --- A. Call LLM (Force Batch) ---
            last_step_result = await self.upstream_step.execute(ctx)
            if last_step_result.status != StepStatus.SUCCESS:
                return last_step_result

            # --- B. Analyze Response ---
            raw_response = ctx.get("upstream_call", "response")
            
            if not raw_response:
                break

            try:
                # Normalize response peeking (best effort)
                choice = raw_response["choices"][0]
                message = choice["message"]
                tool_calls_raw = message.get("tool_calls")
                
                # If we are in the loop and got text content, emit it if stream was requested
                # Note: This simulates streaming for the intermediate thought steps if the model outputs them with tool calls
                if original_stream and message.get("content"):
                    self._emit_delta(ctx, message.get("content"))

            except (KeyError, IndexError, TypeError):
                break

            if not tool_calls_raw:
                # Final answer (no tool calls)
                # If original_stream was True, we should probably emit the final content here
                # because the downstream gateway logic receives stream=False context.
                if original_stream and message.get("content"):
                     # We already emitted content above if it existed.
                     pass
                break

            # --- C. Execute Tools ---
            # 1. Add Assistant message to history
            messages.append(message)
            
            # 2. Process each call
            for tc_raw in tool_calls_raw:
                func = tc_raw.get("function", {})
                args_str = func.get("arguments", "{}")
                if not isinstance(args_str, str):
                    args_str = json.dumps(args_str, ensure_ascii=False)

                tc = ToolCall(
                    id=tc_raw.get("id"),
                    name=func.get("name"),
                    arguments=json.loads(args_str)
                )
                
                # Emit Status Event (Transient Spinner)
                ctx.emit_status(
                    stage="execution",
                    step=self.name,
                    state="running",
                    code="tool.call",
                    meta={"name": tc.name}
                )

                # Emit Tool Block (Persistent UI)
                # Format: <tool_code name="..." status="success">args</tool_code>
                # We assume success initially for the block render, or we could update it.
                # For simplicity, we render it as 'success' so it shows up clearly.
                tool_block = f'\n<tool_code name="{tc.name}" status="success">{args_str}</tool_code>\n'
                self._emit_delta(ctx, tool_block)

                # Find and execute tool
                result = await self._dispatch_tool(ctx, tc)
                
                # Emit Result (Persistent UI)
                result_str = json.dumps(result, ensure_ascii=False)
                if len(result_str) > 2000:
                    result_str = result_str[:2000] + "... (truncated)"
                
                output_block = f"\n> **Tool Output:**\n> {result_str}\n\n"
                self._emit_delta(ctx, output_block)

                # 3. Add Tool result to history
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": tc.name,
                    "content": json.dumps(result, ensure_ascii=False)
                })

            # Loop continues...

        # Final Cleanup: Restore stream and update ctx for downstream steps
        request_body["stream"] = original_stream
        ctx.set("template_render", "request_body", request_body)

        return last_step_result

    async def _dispatch_tool(self, ctx: "WorkflowContext", tool_call: ToolCall) -> Any:
        """
        Dispatches the tool call to either a local plugin or a remote MCP server.
        """
        # 1. Check User MCP Servers
        user_id = ctx.user_id
        if user_id:
            from app.models.user_mcp_server import UserMcpServer
            from sqlalchemy import select
            
            # Find which server owns this tool
            # Optimization: We could have a map in context from discovery step
            stmt = select(UserMcpServer).where(
                UserMcpServer.user_id == user_id,
                UserMcpServer.is_enabled == True,
                UserMcpServer.server_type == "sse",
            )
            res = await ctx.db_session.execute(stmt)
            servers = res.scalars().all()
            
            for server in servers:
                if not server.sse_url:
                    continue
                disabled = set(server.disabled_tools or [])
                for cached_tool in server.tools_cache:
                    if cached_tool["name"] == tool_call.name:
                        if tool_call.name in disabled:
                            return {"error": f"Tool '{tool_call.name}' is disabled."}
                        # Found! Call the remote MCP
                        logger.info(f"Calling remote MCP tool '{tool_call.name}' on {server.sse_url}")
                        
                        # Get auth headers
                        from app.services.mcp.discovery import mcp_discovery_service
                        headers = await mcp_discovery_service._get_auth_headers(ctx.db_session, server)
                        
                        try:
                            result = await mcp_client.call_tool(
                                server.sse_url, 
                                tool_call.name, 
                                tool_call.arguments,
                                headers=headers
                            )
                            return result
                        except Exception as e:
                            return {"error": f"Remote MCP call failed: {str(e)}"}

        # 2. Check Local Plugins (Fallthrough)
        from app.agent_plugins.core.manager import global_plugin_manager
        plugin = global_plugin_manager.get_plugin_for_tool(tool_call.name)
        if plugin:
            handler = getattr(plugin, f"handle_{tool_call.name}", None)
            if not handler:
                handler = getattr(plugin, tool_call.name, None)
            
            if handler:
                # Introspect handler to see if it accepts context
                import inspect
                sig = inspect.signature(handler)
                kwargs = tool_call.arguments.copy()
                if "__context__" in sig.parameters:
                    kwargs["__context__"] = ctx
                
                return await handler(**kwargs)
        
        return {"error": f"Tool '{tool_call.name}' not found."}
