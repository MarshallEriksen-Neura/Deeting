import asyncio
import json
import logging
from copy import deepcopy
from typing import TYPE_CHECKING, Any

from app.core.config import settings
from app.schemas.tool import ToolCall
from app.services.mcp.client import mcp_client
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import (
    BaseStep,
    FailureAction,
    StepResult,
    StepStatus,
)
from app.services.workflow.steps.upstream_call import UpstreamCallStep

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)

_MIN_TOOL_RESULT_LIMIT_CHARS = 512
_DEFAULT_TOOL_CALL_TIMEOUT_SECONDS = 300.0


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
        # Default max_turns is 10, can be overridden by config
        self.max_turns = getattr(config, "max_turns", 10) if config else 10

    # ------------------------------------------------------------------
    # Failure / Degrade hooks
    # ------------------------------------------------------------------

    async def on_failure(
        self,
        ctx: "WorkflowContext",
        error: Exception,
        attempt: int,
    ) -> FailureAction:
        """
        The multi-turn agent loop must NOT blindly retry on timeout because
        tool calls may have already executed with side effects.  Instead we
        *degrade* – return whatever partial result was accumulated so the
        user still gets a response.
        """
        if isinstance(error, TimeoutError):
            logger.warning(
                f"AgentExecutor timeout → DEGRADE "
                f"(attempt={attempt}, trace_id={ctx.trace_id})"
            )
            return FailureAction.DEGRADE

        # For other errors, delegate to base class (honours retry_on)
        return await super().on_failure(ctx, error, attempt)

    async def on_degrade(
        self,
        ctx: "WorkflowContext",
        error: Exception,
    ) -> StepResult:
        """
        Return the last successful LLM response collected during the loop,
        or a clean timeout message so the frontend can render something
        meaningful.
        """
        last_response = ctx.get("agent_executor", "_last_good_response")

        if last_response:
            # Restore the partial response so downstream steps
            # (response_transform, conversation_append, …) can use it.
            ctx.set("upstream_call", "response", last_response)
            logger.info(
                f"AgentExecutor degraded with partial result "
                f"trace_id={ctx.trace_id}"
            )
            return StepResult(
                status=StepStatus.DEGRADED,
                message="Agent loop timed out; returning last successful response.",
            )

        # No partial result available – synthesize a timeout reply so the
        # frontend can display it instead of a raw 500.
        timeout_response = {
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": (
                            "抱歉，处理您的请求时超时了。"
                            "这可能是由于外部工具响应缓慢导致的，请稍后重试。"
                        ),
                    },
                    "finish_reason": "timeout",
                }
            ]
        }
        ctx.set("upstream_call", "response", timeout_response)
        logger.warning(
            f"AgentExecutor degraded without partial result "
            f"trace_id={ctx.trace_id}"
        )
        return StepResult(
            status=StepStatus.DEGRADED,
            message="Agent loop timed out before producing a response.",
        )

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

        # Allow overriding max_turns from request body
        max_turns = request_body.get("max_turns", self.max_turns)

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
        injected_assistant_id = None

        while turn < max_turns:
            turn += 1
            logger.info(f"AgentExecutor turn {turn}/{max_turns} for trace_id {ctx.trace_id}")

            # Update request body with current history
            request_body["messages"] = messages
            ctx.set("template_render", "request_body", request_body)

            # --- A. Call LLM (Force Batch) ---
            last_step_result = await self.upstream_step.execute(ctx)
            if last_step_result.status != StepStatus.SUCCESS:
                return last_step_result

            # --- B. Analyze Response ---
            raw_response = ctx.get("upstream_call", "response")

            # Snapshot for on_degrade: if the step times out later, we can
            # return the last valid LLM response instead of a raw error.
            if raw_response:
                ctx.set("agent_executor", "_last_good_response", deepcopy(raw_response))

            if not raw_response:
                break

            try:
                # Normalize response peeking (best effort)
                choice = raw_response["choices"][0]
                message = choice["message"]
                tool_calls_raw = message.get("tool_calls")

                # If we are in the loop and got text content, emit it if stream was requested
                content = message.get("content")
                if (
                    original_stream
                    and isinstance(content, str)
                    and content.strip()
                ):
                    self._emit_delta(ctx, content)

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

                try:
                    parsed_args = json.loads(args_str)
                except json.JSONDecodeError as e:
                    logger.warning(
                        f"Malformed tool call arguments for '{func.get('name')}': {e} "
                        f"trace_id={ctx.trace_id}"
                    )
                    # Return the parse error as a tool result so the LLM can
                    # self-correct on the next turn instead of crashing the step.
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc_raw.get("id"),
                            "name": func.get("name"),
                            "content": (
                                f"Error: Failed to parse tool call arguments as JSON: {e}. "
                                f"Please fix the JSON syntax and try again."
                            ),
                        }
                    )
                    continue

                tc = ToolCall(
                    id=tc_raw.get("id"),
                    name=func.get("name"),
                    arguments=parsed_args,
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
                ui_blocks = self._extract_tool_ui_blocks(result)
                debug_payload = self._extract_tool_debug_payload(result)

                tool_error = None
                tool_success = True
                if isinstance(result, dict) and "error" in result:
                    tool_error = result.get("error")
                    tool_success = False

                # Format result once for both persistence and UI streaming
                formatted_result = self._format_tool_result(result)
                history_result, history_truncated = self._trim_tool_result_for_history(
                    formatted_result
                )

                tool_calls_log = ctx.get("execution", "tool_calls") or []
                if isinstance(tool_calls_log, list):
                    tool_calls_log.append(
                        {
                            "name": tc.name,
                            "tool_call_id": tc.id,
                            "success": tool_success,
                            "error": tool_error,
                            "output": history_result,
                            "truncated": history_truncated,
                            "ui_blocks": ui_blocks,
                            "debug": debug_payload,
                        }
                    )
                    ctx.set("execution", "tool_calls", tool_calls_log)

                # Emit Tool Result (Persistent UI)
                result_preview = history_result
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
                            **({"ui": ui_blocks} if ui_blocks else {}),
                            **({"debug": debug_payload} if debug_payload else {}),
                        }
                    ],
                )
                if ui_blocks:
                    self._emit_blocks(ctx, ui_blocks)

                # 3. Add Tool result to history
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "name": tc.name,
                        "content": history_result,
                    }
                )

            # --- D. Mid-loop Assistant Injection ---
            # If consult_expert_network (or semantic_kernel) activated an assistant,
            # inject its prompt + tools for subsequent LLM turns.
            new_assistant_id = ctx.get("assistant", "id")
            if new_assistant_id and new_assistant_id != injected_assistant_id:
                injected_assistant_id = new_assistant_id
                await self._inject_assistant_mid_loop(
                    ctx, request_body, messages, new_assistant_id
                )

            # Loop continues...

        # Final Cleanup: Restore stream and update ctx for downstream steps
        request_body["stream"] = original_stream
        ctx.set("template_render", "request_body", request_body)

        return last_step_result

    async def _inject_assistant_mid_loop(
        self,
        ctx: "WorkflowContext",
        request_body: dict[str, Any],
        messages: list[dict],
        assistant_id: str,
    ) -> None:
        """
        Inject an assistant's system prompt and skill_refs tools mid-loop.

        Called when consult_expert_network activates an assistant during the agent loop.
        Adds the assistant's prompt as a system message and merges its declared tools.
        """
        try:
            from sqlalchemy import select
            from app.models.assistant import Assistant, AssistantVersion
            from app.services.assistant.skill_resolver import (
                resolve_skill_refs,
                skill_tools_to_openai_format,
            )

            if not ctx.db_session:
                return

            # Fetch assistant data
            stmt = (
                select(
                    AssistantVersion.system_prompt,
                    AssistantVersion.skill_refs,
                    AssistantVersion.name,
                )
                .join(Assistant, Assistant.current_version_id == AssistantVersion.id)
                .where(Assistant.id == assistant_id)
            )
            result = await ctx.db_session.execute(stmt)
            row = result.first()
            if not row:
                logger.warning(
                    f"Mid-loop injection: Assistant {assistant_id} not found"
                )
                return

            system_prompt, skill_refs, name = row[0], row[1], row[2]

            # Inject system prompt as a system message
            if system_prompt:
                messages.append(
                    {
                        "role": "system",
                        "content": f"[Assistant Activated: {name}]\n\n{system_prompt}",
                    }
                )
                logger.info(
                    f"Mid-loop: Injected system prompt for assistant '{name}' ({assistant_id})"
                )

            # Resolve and inject skill_refs tools
            if skill_refs:
                skill_tools = await resolve_skill_refs(skill_refs)
                if skill_tools:
                    openai_tools = skill_tools_to_openai_format(skill_tools)
                    existing_tools = request_body.get("tools", [])
                    existing_names = {
                        t.get("function", {}).get("name")
                        for t in existing_tools
                        if isinstance(t, dict)
                    }
                    new_tools = [
                        t
                        for t in openai_tools
                        if t.get("function", {}).get("name") not in existing_names
                    ]
                    existing_tools.extend(new_tools)
                    request_body["tools"] = existing_tools
                    logger.info(
                        f"Mid-loop: Injected {len(new_tools)} skill tools for assistant '{name}'"
                    )

            # Remove consult_expert_network from tools (assistant is now locked)
            tools = request_body.get("tools", [])
            request_body["tools"] = [
                t
                for t in tools
                if t.get("function", {}).get("name") != "consult_expert_network"
            ]

        except Exception as e:
            # Fail-open: log but don't crash the agent loop
            logger.error(f"Mid-loop assistant injection failed: {e}", exc_info=True)

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

    def _extract_tool_ui_blocks(self, result: Any) -> list[dict[str, Any]]:
        if not isinstance(result, dict):
            return []

        raw_blocks: list[Any] = []
        ui_payload = result.get("ui")
        if isinstance(ui_payload, dict):
            ui_blocks = ui_payload.get("blocks")
            if isinstance(ui_blocks, list):
                raw_blocks.extend(ui_blocks)
        elif isinstance(ui_payload, list):
            raw_blocks.extend(ui_payload)

        render_payload = result.get("__render__")
        if isinstance(render_payload, dict):
            raw_blocks.append(render_payload)

        normalized: list[dict[str, Any]] = []
        for item in raw_blocks:
            block = self._normalize_ui_block(item)
            if block:
                normalized.append(block)
        return normalized

    def _normalize_ui_block(self, item: Any) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None

        view_type = str(item.get("viewType") or item.get("view_type") or "").strip()
        if not view_type:
            return None

        payload = item.get("payload")
        if payload is None:
            payload = {}

        block: dict[str, Any] = {
            "type": "ui",
            "viewType": view_type,
            "view_type": view_type,
            "payload": payload,
        }
        title = item.get("title")
        if isinstance(title, str) and title.strip():
            block["title"] = title.strip()
        metadata = item.get("metadata")
        if metadata is None:
            metadata = item.get("meta")
        if metadata is not None:
            block["metadata"] = metadata
        return block

    def _extract_tool_debug_payload(self, result: Any) -> dict[str, Any] | None:
        if not isinstance(result, dict):
            return None

        runtime = result.get("runtime")
        if not isinstance(runtime, dict):
            return None

        debug: dict[str, Any] = {}

        for key in ("execution_id", "session_id", "submitted_at"):
            value = runtime.get(key)
            if isinstance(value, str) and value:
                debug[key] = value

        sdk_stub = runtime.get("sdk_stub")
        if isinstance(sdk_stub, dict):
            debug["sdk_stub"] = sdk_stub

        runtime_calls = runtime.get("runtime_tool_calls")
        if isinstance(runtime_calls, dict):
            debug["runtime_tool_calls"] = runtime_calls

        render_blocks = runtime.get("render_blocks")
        if isinstance(render_blocks, dict):
            render_debug: dict[str, Any] = {}
            count = render_blocks.get("count")
            if isinstance(count, int):
                render_debug["count"] = count
            blocks = render_blocks.get("blocks")
            if isinstance(blocks, list):
                render_debug["count"] = len(blocks)
            if render_debug:
                debug["render_blocks"] = render_debug

        status = result.get("status")
        if isinstance(status, str) and status:
            debug["status"] = status

        exit_code = result.get("exit_code")
        if isinstance(exit_code, int):
            debug["exit_code"] = exit_code

        if result.get("truncated") is True:
            debug["truncated"] = True

        error_code = result.get("error_code")
        if isinstance(error_code, str) and error_code:
            debug["error_code"] = error_code

        return debug or None

    def _trim_tool_result_for_history(self, result: str) -> tuple[str, bool]:
        """
        Keep tool payload bounded before injecting it back into LLM messages.
        This avoids context-window failures when tools return very large outputs.
        """
        limit = getattr(settings, "AGENT_TOOL_RESULT_MAX_CHARS", 12000)
        try:
            limit = int(limit)
        except Exception:
            limit = 12000

        limit = max(_MIN_TOOL_RESULT_LIMIT_CHARS, limit)
        if len(result) <= limit:
            return result, False

        omitted = len(result) - limit
        suffix = (
            "\n\n"
            f"[tool_result_truncated omitted_chars={omitted} "
            f"original_chars={len(result)}]"
        )
        return result[:limit] + suffix, True

    def _resolve_tool_call_timeout_seconds(self) -> float:
        """
        Resolve per-tool timeout with config fallback.

        The effective timeout is bounded by current step timeout so tool calls
        do not outlive the agent_executor step budget.
        """
        configured = getattr(
            settings,
            "AGENT_TOOL_CALL_TIMEOUT_SECONDS",
            _DEFAULT_TOOL_CALL_TIMEOUT_SECONDS,
        )
        try:
            tool_timeout = float(configured)
        except Exception:
            tool_timeout = _DEFAULT_TOOL_CALL_TIMEOUT_SECONDS

        if tool_timeout <= 0:
            tool_timeout = _DEFAULT_TOOL_CALL_TIMEOUT_SECONDS

        step_timeout = getattr(self.config, "timeout", None)
        try:
            step_timeout_value = float(step_timeout) if step_timeout is not None else None
        except Exception:
            step_timeout_value = None

        if step_timeout_value and step_timeout_value > 0:
            return min(tool_timeout, step_timeout_value)

        return tool_timeout

    async def _dispatch_tool(self, ctx: "WorkflowContext", tool_call: ToolCall, user_mcp_tool_map: dict[str, Any]) -> Any:
        """
        Dispatches the tool call to either a local plugin or a remote MCP server.

        Each invocation is wrapped with a hard timeout so that a single slow
        tool cannot consume the entire step budget.
        """
        timeout_seconds = self._resolve_tool_call_timeout_seconds()
        timeout_display = f"{timeout_seconds:g}"
        try:
            return await asyncio.wait_for(
                self._dispatch_tool_inner(ctx, tool_call, user_mcp_tool_map),
                timeout=timeout_seconds,
            )
        except TimeoutError:
            logger.warning(
                f"Tool '{tool_call.name}' timed out after {timeout_display}s "
                f"trace_id={ctx.trace_id}"
            )
            return {
                "error": (
                    f"Tool '{tool_call.name}' timed out after "
                    f"{timeout_display}s. The external service may be "
                    f"slow or unreachable."
                )
            }

    async def _dispatch_tool_inner(self, ctx: "WorkflowContext", tool_call: ToolCall, user_mcp_tool_map: dict[str, Any]) -> Any:
        """
        Inner dispatch logic (no timeout wrapper).
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

        # 2. Check Local Plugins (instantiate per-request to avoid shared-state races)
        from app.agent_plugins.core.context import ConcretePluginContext
        from app.services.agent.agent_service import agent_service
        import uuid as _uuid

        _uid = None
        if ctx.user_id:
            try:
                parsed_uid = _uuid.UUID(str(ctx.user_id))
                if parsed_uid.int != 0:
                    _uid = parsed_uid
            except (ValueError, TypeError):
                pass

        if not _uid:
            logger.warning(
                "Tool '%s' denied: missing real user_id in context trace_id=%s",
                tool_call.name,
                ctx.trace_id,
            )
            return {
                "error": (
                    f"Tool '{tool_call.name}' requires a real user_id context. "
                    "Please retry with authenticated user context."
                )
            }

        plugin_name = agent_service.plugin_manager.get_plugin_name_for_tool_from_registry(
            tool_call.name
        )
        if plugin_name:
            try:
                fresh_ctx = ConcretePluginContext(
                    plugin_name=plugin_name,
                    plugin_id=plugin_name,
                    user_id=_uid,
                    session_id=ctx.session_id,
                )
                plugin = await agent_service.plugin_manager.instantiate_plugin(
                    plugin_name, fresh_ctx
                )
            except Exception as exc:
                logger.warning(
                    "Tool '%s' denied: failed to bind user context trace_id=%s err=%s",
                    tool_call.name,
                    ctx.trace_id,
                    exc,
                )
                return {
                    "error": (
                        f"Tool '{tool_call.name}' could not bind user context: {exc}"
                    )
                }

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

                try:
                    if is_generic:
                        return await handler(tool_call.name, **kwargs)
                    else:
                        return await handler(**kwargs)
                except TypeError as e:
                    logger.warning(
                        f"Tool '{tool_call.name}' parameter error: {e}"
                    )
                    return {
                        "error": f"Invalid parameters for tool '{tool_call.name}': {e}. Check required parameters."
                    }
                except Exception as e:
                    logger.error(
                        f"Tool '{tool_call.name}' execution failed: {e}",
                        exc_info=True,
                    )
                    return {"error": f"Tool '{tool_call.name}' failed: {e}"}

        return {"error": f"Tool '{tool_call.name}' not found."}
