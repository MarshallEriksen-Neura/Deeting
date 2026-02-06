import json
import logging
from copy import deepcopy
from typing import TYPE_CHECKING, Any

from app.schemas.tool import ToolCall
from app.services.mcp.client import mcp_client
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus
from app.services.workflow.steps.upstream_call import UpstreamCallStep

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

        payload = {"choices": [{"index": 0, "delta": {"content": content}}]}
        ctx.status_emitter(payload)

    def _emit_blocks(self, ctx: "WorkflowContext", blocks: list[dict[str, Any]]) -> None:
        """
        Emit structured blocks to the client stream.

        NOTE: This is the preferred UI contract in dev mode; the frontend can render blocks
        directly without parsing legacy tags like <tool_code> / <think>.
        """
        if not ctx.status_emitter or not blocks:
            return
        ctx.status_emitter(
            {
                "type": "blocks",
                "blocks": blocks,
                "trace_id": ctx.trace_id,
                "timestamp": ctx.created_at.isoformat(),
            }
        )

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        # 1. Get initial state
        raw_request_body = ctx.get("template_render", "request_body")
        if not raw_request_body:
            return StepResult(
                status=StepStatus.FAILED, message="Missing rendered request body"
            )

        # Deep copy to avoid mutating the original context prematurely
        request_body = deepcopy(raw_request_body)

        # Remember original stream setting
        original_stream = request_body.get("stream", False)

        # We MUST use non-streaming for intermediate turns to parse tool calls
        request_body["stream"] = False

        # Maintain chat history locally for the loop
        messages = request_body.get("messages", [])

        # Build User MCP Tool Map once for this execution
        user_mcp_tool_map = await self._build_user_mcp_tool_map(ctx)

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
                if original_stream and message.get("content"):
                    self._emit_delta(ctx, message.get("content"))

            except (KeyError, IndexError, TypeError):
                break

            if not tool_calls_raw:
                # Final answer (no tool calls)
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
                    arguments=json.loads(args_str),
                )

                # Emit Status Event (Transient Spinner)
                ctx.emit_status(
                    stage="execution",
                    step=self.name,
                    state="running",
                    code="tool.call",
                    meta={"name": tc.name},
                )

                # Emit Tool Block (Persistent UI)
                self._emit_blocks(
                    ctx,
                    [
                        {
                            "type": "tool_call",
                            "callId": tc.id,
                            "toolName": tc.name,
                            "toolArgs": args_str,
                            "status": "running",
                        }
                    ],
                )

                # Find and execute tool
                result = await self._dispatch_tool(ctx, tc, user_mcp_tool_map)
                
                tool_error = None
                tool_success = True
                if isinstance(result, dict) and "error" in result:
                    tool_error = result.get("error")
                    tool_success = False

                # Format result once for both persistence and UI streaming
                formatted_result = self._format_tool_result(result)
                
                tool_calls_log = ctx.get("execution", "tool_calls") or []
                if isinstance(tool_calls_log, list):
                    tool_calls_log.append(
                        {
                            "name": tc.name,
                            "tool_call_id": tc.id,
                            "success": tool_success,
                            "error": tool_error,
                            "output": formatted_result,
                        }
                    )
                    ctx.set("execution", "tool_calls", tool_calls_log)

                # Emit Tool Result (Persistent UI)
                result_preview = formatted_result
                if len(result_preview) > 2000:
                    result_preview = result_preview[:2000] + "... (truncated)"
                self._emit_blocks(
                    ctx,
                    [
                        {
                            "type": "tool_result",
                            "callId": tc.id,
                            "toolName": tc.name,
                            "status": "error" if not tool_success else "success",
                            "result": (
                                tool_error if not tool_success and tool_error else result_preview
                            ),
                        }
                    ],
                )

                # 3. Add Tool result to history
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "name": tc.name,
                        "content": formatted_result,
                    }
                )

            # Loop continues...

        # Final Cleanup: Restore stream and update ctx for downstream steps
        request_body["stream"] = original_stream
        ctx.set("template_render", "request_body", request_body)

        return last_step_result

    async def _build_user_mcp_tool_map(self, ctx: "WorkflowContext") -> dict[str, Any]:
        """
        Pre-builds a map of tool names to their respective MCP servers for the current user.
        """
        user_id = ctx.user_id
        if not user_id or not ctx.db_session:
            return {}

        from sqlalchemy import select
        from app.models.user_mcp_server import UserMcpServer
        from app.services.mcp.discovery import mcp_discovery_service

        stmt = select(UserMcpServer).where(
            UserMcpServer.user_id == user_id,
            UserMcpServer.is_enabled == True,
            UserMcpServer.server_type == "sse",
        )
        res = await ctx.db_session.execute(stmt)
        servers = res.scalars().all()

        tool_map = {}
        for server in servers:
            if not server.sse_url:
                continue
            
            # Resolve headers once per server
            headers = await mcp_discovery_service._get_auth_headers(ctx.db_session, server)
            disabled = set(server.disabled_tools or [])
            
            for cached_tool in server.tools_cache or []:
                name = cached_tool.get("name")
                if not name or name in disabled:
                    continue
                
                if name not in tool_map:
                    tool_map[name] = {
                        "sse_url": server.sse_url,
                        "headers": headers,
                        "server_name": server.name
                    }
        
        return tool_map

    def _format_tool_result(self, result: Any) -> str:
        """
        Standardizes tool output into a string format.
        Handles MCP TextContent lists and other types.
        """
        if result is None:
            return "null"
        
        # Handle MCP Content Blocks
        if isinstance(result, list):
            texts = []
            for item in result:
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        texts.append(item.get("text", ""))
                    elif item.get("type") == "image":
                        texts.append("[Image Content]")
                elif hasattr(item, "type") and getattr(item, "type") == "text":
                    texts.append(getattr(item, "text", ""))
            
            if texts:
                return "\n".join(texts)
        
        if isinstance(result, (dict, list)):
            return json.dumps(result, ensure_ascii=False)
        
        return str(result)

    async def _dispatch_tool(self, ctx: "WorkflowContext", tool_call: ToolCall, user_mcp_tool_map: dict[str, Any]) -> Any:
        """
        Dispatches the tool call to either a local plugin or a remote MCP server.
        """
        # 1. Check User MCP Servers (via pre-built map)
        if tool_call.name in user_mcp_tool_map:
            mcp_info = user_mcp_tool_map[tool_call.name]
            logger.info(
                f"Calling remote MCP tool '{tool_call.name}' on {mcp_info['sse_url']} ({mcp_info['server_name']})"
            )
            try:
                result = await mcp_client.call_tool(
                    mcp_info["sse_url"],
                    tool_call.name,
                    tool_call.arguments,
                    headers=mcp_info["headers"],
                )
                return result
            except Exception as e:
                logger.error(f"Remote MCP call failed: {e!s}")
                return {"error": f"Remote MCP call failed: {e!s}"}

        # 2. Check Local Plugins (Fallthrough)
        from app.agent_plugins.core.manager import global_plugin_manager

        plugin = global_plugin_manager.get_plugin_for_tool(tool_call.name)
        if plugin:
            # 1. Try specific handler (handle_toolname)
            handler = getattr(plugin, f"handle_{tool_call.name}", None)
            if not handler:
                handler = getattr(plugin, tool_call.name, None)

            # 2. Try generic handler (handle_tool_call)
            is_generic = False
            if not handler and hasattr(plugin, "handle_tool_call"):
                handler = plugin.handle_tool_call
                is_generic = True

            if handler:
                # Introspect handler to see if it accepts context
                import inspect

                sig = inspect.signature(handler)
                kwargs = tool_call.arguments.copy()
                if "__context__" in sig.parameters or "kwargs" in sig.parameters:
                    kwargs["__context__"] = ctx

                if is_generic:
                    return await handler(tool_call.name, **kwargs)
                else:
                    return await handler(**kwargs)

        return {"error": f"Tool '{tool_call.name}' not found."}
