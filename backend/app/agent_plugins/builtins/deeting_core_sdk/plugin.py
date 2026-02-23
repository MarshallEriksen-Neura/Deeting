import ast
import hashlib
import inspect
import json
import logging
import textwrap
import uuid
from datetime import UTC, datetime
from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.sandbox.manager import sandbox_manager
from app.schemas.tool import ToolDefinition
from app.services.tools.tool_context_service import tool_context_service

logger = logging.getLogger(__name__)

_MAX_SEARCH_LIMIT = 20
_MAX_CODE_CHARS = 12000
_MAX_RESULT_CHARS = 4000
_MAX_TOOL_PLAN_STEPS = 20
_FORBIDDEN_IMPORT_ROOTS = {
    "aiohttp",
    "ftplib",
    "httpx",
    "paramiko",
    "requests",
    "socket",
    "subprocess",
    "telnetlib",
    "urllib",
    "websocket",
    "websockets",
}
_FORBIDDEN_CALL_NAMES = {"__import__", "compile", "eval", "exec"}
_FORBIDDEN_CALL_ATTRIBUTES = {
    "os.popen",
    "os.system",
    "subprocess.Popen",
    "subprocess.call",
    "subprocess.check_call",
    "subprocess.check_output",
    "subprocess.run",
}

_RUNTIME_PREAMBLE = textwrap.dedent(
    """
    class DeetingRuntime:
        def __init__(self):
            self.version = "1.0.0"

        def log(self, *args):
            print("[deeting.log]", *args)

        def section(self, title):
            print(f"\\n[deeting.section] {title}")

    deeting = DeetingRuntime()
    """
)


class DeetingCoreSdkPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system.deeting_core_sdk",
            version="1.0.0",
            description=(
                "Code Mode core tools. Search SDK signatures and execute code plans "
                "in OpenSandbox."
            ),
            author="System",
        )

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "search_sdk",
                    "description": (
                        "Search Deeting SDK capabilities by intent and return typed "
                        "signatures. Use before execute_code_plan."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Natural language intent to search tools.",
                            },
                            "limit": {
                                "type": "integer",
                                "description": "Max items to return (1-20).",
                                "default": 8,
                            },
                            "include_schema": {
                                "type": "boolean",
                                "description": "Whether to include full JSON schema.",
                                "default": False,
                            },
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "execute_code_plan",
                    "description": (
                        "Execute a Python code plan in sandbox. Runtime exposes "
                        "`deeting.log()` and `deeting.section()` helpers."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "type": "string",
                                "description": "Python code to execute.",
                            },
                            "session_id": {
                                "type": "string",
                                "description": "Optional explicit session ID.",
                            },
                            "language": {
                                "type": "string",
                                "description": "Execution language. Only python is supported.",
                                "default": "python",
                            },
                            "execution_timeout": {
                                "type": "integer",
                                "description": "Execution timeout hint in seconds.",
                                "default": 30,
                            },
                            "dry_run": {
                                "type": "boolean",
                                "description": "Only validate code and return plan metadata without executing.",
                                "default": False,
                            },
                            "tool_plan": {
                                "type": "array",
                                "description": (
                                    "Optional declarative tool steps. Each step is executed "
                                    "sequentially before sandbox code execution."
                                ),
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "step_id": {
                                            "type": "string",
                                            "description": "Optional step identifier.",
                                        },
                                        "tool_name": {
                                            "type": "string",
                                            "description": "Real tool name to invoke.",
                                        },
                                        "arguments": {
                                            "type": "object",
                                            "description": "Tool arguments.",
                                            "default": {},
                                        },
                                        "save_as": {
                                            "type": "string",
                                            "description": "Result key saved into TOOL_PLAN_RESULTS.",
                                        },
                                        "on_error": {
                                            "type": "string",
                                            "enum": ["stop", "continue"],
                                            "default": "stop",
                                            "description": "Error handling strategy for this step.",
                                        },
                                    },
                                    "required": ["tool_name"],
                                },
                            },
                        },
                        "required": ["code"],
                    },
                },
            },
        ]

    async def handle_search_sdk(
        self,
        query: str,
        limit: int = 8,
        include_schema: bool = False,
        __context__: Any | None = None,
    ) -> dict[str, Any]:
        q = (query or "").strip()
        if not q:
            return {"error": "query is required", "error_code": "CODE_MODE_EMPTY_QUERY"}

        try:
            safe_limit = max(1, min(int(limit or 8), _MAX_SEARCH_LIMIT))
        except (TypeError, ValueError):
            safe_limit = 8

        try:
            user_id = self._resolve_user_id(__context__)
        except Exception as exc:
            return {
                "error": f"invalid user context: {exc}",
                "error_code": "CODE_MODE_INVALID_CONTEXT",
            }

        try:
            tools = await self._build_tool_candidates(user_id=user_id, query=q)
        except Exception as exc:
            logger.error("search_sdk build_tools failed: %s", exc, exc_info=True)
            return {
                "error": f"search_sdk failed: {exc}",
                "error_code": "CODE_MODE_SEARCH_FAILED",
            }

        items: list[dict[str, Any]] = []
        for tool in tools:
            if tool.name in {"search_sdk", "execute_code_plan"}:
                continue
            item = {
                "name": tool.name,
                "description": tool.description or "",
                "signature": self._build_signature(tool),
            }
            if include_schema:
                item["input_schema"] = tool.input_schema
            items.append(item)
            if len(items) >= safe_limit:
                break

        return {
            "mode": "code_mode",
            "query": q,
            "count": len(items),
            "tools": items,
            "usage_hint": (
                "先根据签名规划步骤，再调用 execute_code_plan 一次性执行。"
            ),
        }

    async def handle_execute_code_plan(
        self,
        code: str,
        session_id: str | None = None,
        language: str = "python",
        execution_timeout: int = 30,
        dry_run: bool = False,
        tool_plan: list[dict[str, Any]] | None = None,
        __context__: Any | None = None,
    ) -> dict[str, Any]:
        source = (code or "").strip()
        if not source:
            return {"error": "code is required", "error_code": "CODE_MODE_EMPTY_CODE"}
        if len(source) > _MAX_CODE_CHARS:
            return {
                "error": f"code is too long (> {_MAX_CODE_CHARS} chars)",
                "error_code": "CODE_MODE_CODE_TOO_LONG",
            }

        normalized_language = (language or "python").strip().lower()
        if normalized_language != "python":
            return {
                "error": f"unsupported language: {language}",
                "error_code": "CODE_MODE_UNSUPPORTED_LANGUAGE",
            }

        violations = self._validate_python_code(source)
        if violations:
            return {
                "error": "code validation failed",
                "error_code": "CODE_MODE_VALIDATION_FAILED",
                "violations": violations,
            }

        final_session_id = self._resolve_session_id(
            explicit_session_id=session_id, workflow_context=__context__
        )
        runtime_meta = self._build_runtime_meta(source, final_session_id)
        safe_tool_plan = tool_plan if isinstance(tool_plan, list) else []

        if dry_run:
            plan_validation = self._validate_tool_plan(safe_tool_plan)
            return {
                "status": "dry_run",
                "runtime": runtime_meta,
                "language": normalized_language,
                "validation": {
                    "ok": len(plan_validation) == 0,
                    "violations": plan_validation,
                    "code_chars": len(source),
                },
                "tool_plan": {
                    "steps": len(safe_tool_plan),
                    "executed": False,
                },
            }

        plan_validation = self._validate_tool_plan(safe_tool_plan)
        if plan_validation:
            return {
                "status": "failed",
                "runtime": runtime_meta,
                "error": "tool_plan validation failed",
                "error_code": "CODE_MODE_TOOL_PLAN_INVALID",
                "violations": plan_validation,
            }

        tool_plan_results: dict[str, Any] = {}
        if safe_tool_plan:
            plan_execution = await self._execute_tool_plan(
                safe_tool_plan, workflow_context=__context__
            )
            runtime_meta["tool_plan"] = plan_execution.get("summary", {})
            if plan_execution.get("status") == "failed":
                return {
                    "status": "failed",
                    "runtime": runtime_meta,
                    "error": plan_execution.get("error"),
                    "error_code": "CODE_MODE_TOOL_PLAN_FAILED",
                    "steps": plan_execution.get("steps", []),
                }
            tool_plan_results = plan_execution.get("results", {})

        wrapped_code = self._build_wrapped_code(
            source,
            tool_plan_results=tool_plan_results,
        )
        try:
            timeout_value = int(execution_timeout or 30)
        except (TypeError, ValueError):
            timeout_value = 30

        result = await sandbox_manager.run_code(
            final_session_id,
            wrapped_code,
            language=normalized_language,
            execution_timeout=timeout_value,
        )
        return self._format_execution_result(result, final_session_id, runtime_meta)

    async def _build_tool_candidates(
        self, *, user_id: uuid.UUID, query: str
    ) -> list[ToolDefinition]:
        db_session_ctx = self.context.get_db_session()
        if hasattr(db_session_ctx, "__aenter__"):
            async with db_session_ctx as db_session:
                return await tool_context_service.build_tools(
                    session=db_session,
                    user_id=user_id,
                    query=query,
                )

        return await tool_context_service.build_tools(
            session=None,
            user_id=user_id,
            query=query,
        )

    def _resolve_user_id(self, workflow_context: Any | None) -> uuid.UUID:
        raw_user_id = getattr(workflow_context, "user_id", None) or self.context.user_id
        if isinstance(raw_user_id, uuid.UUID):
            return raw_user_id
        return uuid.UUID(str(raw_user_id))

    def _resolve_session_id(
        self, *, explicit_session_id: str | None, workflow_context: Any | None
    ) -> str:
        if explicit_session_id:
            return explicit_session_id

        context_session_id = getattr(workflow_context, "session_id", None)
        if context_session_id:
            return str(context_session_id)

        if self.context.session_id:
            return str(self.context.session_id)

        return f"user:{self.context.user_id}"

    def _build_signature(self, tool: ToolDefinition) -> str:
        schema = tool.input_schema if isinstance(tool.input_schema, dict) else {}
        properties = schema.get("properties") or {}
        required = set(schema.get("required") or [])

        parts: list[str] = []
        for name, prop in properties.items():
            prop_schema = prop if isinstance(prop, dict) else {}
            tp = prop_schema.get("type", "any")
            req_mark = "" if name in required else "?"
            parts.append(f"{name}{req_mark}:{tp}")
        return f"{tool.name}({', '.join(parts)})"

    def _validate_python_code(self, code: str) -> list[str]:
        violations: list[str] = []
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            msg = f"syntax error at line {exc.lineno}: {exc.msg}"
            return [msg]

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root = alias.name.split(".")[0]
                    if root in _FORBIDDEN_IMPORT_ROOTS:
                        violations.append(f"forbidden import: {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                root = (node.module or "").split(".")[0]
                if root in _FORBIDDEN_IMPORT_ROOTS:
                    violations.append(f"forbidden import: {node.module}")
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id in _FORBIDDEN_CALL_NAMES:
                        violations.append(f"forbidden call: {node.func.id}")
                elif isinstance(node.func, ast.Attribute) and isinstance(
                    node.func.value, ast.Name
                ):
                    full_name = f"{node.func.value.id}.{node.func.attr}"
                    if full_name in _FORBIDDEN_CALL_ATTRIBUTES:
                        violations.append(f"forbidden call: {full_name}")

        return sorted(set(violations))

    def _validate_tool_plan(self, tool_plan: list[dict[str, Any]]) -> list[str]:
        violations: list[str] = []
        if len(tool_plan) > _MAX_TOOL_PLAN_STEPS:
            violations.append(
                f"tool_plan steps exceed limit {_MAX_TOOL_PLAN_STEPS}: {len(tool_plan)}"
            )
        for idx, step in enumerate(tool_plan):
            if not isinstance(step, dict):
                violations.append(f"step[{idx}] must be object")
                continue

            tool_name = str(step.get("tool_name") or "").strip()
            if not tool_name:
                violations.append(f"step[{idx}] missing tool_name")
            elif tool_name in {"search_sdk", "execute_code_plan"}:
                violations.append(f"step[{idx}] tool_name '{tool_name}' is not allowed")

            raw_args = step.get("arguments", {})
            if raw_args is not None and not isinstance(raw_args, dict):
                violations.append(f"step[{idx}] arguments must be object")

            on_error = str(step.get("on_error") or "stop").strip().lower()
            if on_error not in {"stop", "continue"}:
                violations.append(
                    f"step[{idx}] on_error must be 'stop' or 'continue', got '{on_error}'"
                )
        return violations

    async def _execute_tool_plan(
        self,
        tool_plan: list[dict[str, Any]],
        *,
        workflow_context: Any | None,
    ) -> dict[str, Any]:
        results: dict[str, Any] = {}
        steps_log: list[dict[str, Any]] = []

        for idx, step in enumerate(tool_plan):
            step_id = str(step.get("step_id") or f"step_{idx + 1}")
            tool_name = str(step.get("tool_name") or "").strip()
            on_error = str(step.get("on_error") or "stop").strip().lower()
            save_key = str(step.get("save_as") or step_id)
            raw_args = step.get("arguments") or {}
            resolved_args = self._resolve_plan_arguments(raw_args, results)

            tool_result = await self._dispatch_real_tool(
                tool_name=tool_name,
                arguments=resolved_args,
                workflow_context=workflow_context,
            )
            normalized_result = self._to_jsonable(tool_result)
            step_error = None
            if isinstance(normalized_result, dict) and normalized_result.get("error"):
                step_error = str(normalized_result.get("error"))

            steps_log.append(
                {
                    "step_id": step_id,
                    "tool_name": tool_name,
                    "status": "failed" if step_error else "success",
                    "save_as": save_key,
                    "error": step_error,
                }
            )

            if step_error:
                if on_error == "continue":
                    results[save_key] = normalized_result
                    continue
                return {
                    "status": "failed",
                    "error": f"tool_plan step '{step_id}' failed: {step_error}",
                    "steps": steps_log,
                    "results": results,
                    "summary": {"steps": len(tool_plan), "success": False},
                }

            results[save_key] = normalized_result

        return {
            "status": "success",
            "steps": steps_log,
            "results": results,
            "summary": {"steps": len(tool_plan), "success": True},
        }

    def _resolve_plan_arguments(
        self,
        value: Any,
        results: dict[str, Any],
    ) -> Any:
        if isinstance(value, dict):
            if set(value.keys()) == {"$ref"}:
                return self._lookup_plan_ref(results, str(value.get("$ref") or ""))
            return {
                key: self._resolve_plan_arguments(child, results)
                for key, child in value.items()
            }
        if isinstance(value, list):
            return [self._resolve_plan_arguments(item, results) for item in value]
        if isinstance(value, str) and value.startswith("$ref:"):
            return self._lookup_plan_ref(results, value[5:].strip())
        return value

    def _lookup_plan_ref(self, results: dict[str, Any], ref: str) -> Any:
        ref = (ref or "").strip()
        if not ref:
            return None

        cursor: Any = results
        for part in ref.split("."):
            if isinstance(cursor, dict) and part in cursor:
                cursor = cursor[part]
                continue
            return None
        return cursor

    async def _dispatch_real_tool(
        self,
        *,
        tool_name: str,
        arguments: dict[str, Any],
        workflow_context: Any | None,
    ) -> Any:
        local_result = await self._dispatch_local_tool(tool_name, arguments, workflow_context)
        if local_result is not None:
            return local_result
        return await self._dispatch_remote_mcp_tool(tool_name, arguments, workflow_context)

    async def _dispatch_local_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        workflow_context: Any | None,
    ) -> Any | None:
        from app.agent_plugins.core.context import ConcretePluginContext
        from app.services.agent.agent_service import agent_service

        plugin_name = agent_service.plugin_manager.get_plugin_name_for_tool_from_registry(
            tool_name
        )
        if not plugin_name:
            return None

        fresh_ctx = ConcretePluginContext(
            plugin_name=plugin_name,
            plugin_id=plugin_name,
            user_id=self.context.user_id,
            session_id=self._resolve_session_id(
                explicit_session_id=None, workflow_context=workflow_context
            ),
        )
        plugin = await agent_service.plugin_manager.instantiate_plugin(plugin_name, fresh_ctx)

        handler = getattr(plugin, f"handle_{tool_name}", None)
        if not handler:
            handler = getattr(plugin, tool_name, None)
        is_generic = False
        if not handler and hasattr(plugin, "handle_tool_call"):
            handler = plugin.handle_tool_call
            is_generic = True
        if not handler:
            return {"error": f"Tool '{tool_name}' handler not found in plugin '{plugin_name}'"}

        kwargs = dict(arguments or {})
        try:
            sig = inspect.signature(handler)
            if "__context__" in sig.parameters or "kwargs" in sig.parameters:
                kwargs["__context__"] = workflow_context
        except Exception:
            pass

        try:
            if is_generic:
                return await handler(tool_name, **kwargs)
            return await handler(**kwargs)
        except Exception as exc:
            logger.error("local tool call failed name=%s err=%s", tool_name, exc, exc_info=True)
            return {"error": f"Local tool '{tool_name}' failed: {exc}"}

    async def _dispatch_remote_mcp_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        workflow_context: Any | None,
    ) -> Any:
        from sqlalchemy import select

        from app.models.user_mcp_server import UserMcpServer
        from app.services.mcp.client import mcp_client
        from app.services.mcp.discovery import mcp_discovery_service

        db_session = getattr(workflow_context, "db_session", None)
        managed_ctx = None
        if db_session is None:
            managed_ctx = self.context.get_db_session()
            if hasattr(managed_ctx, "__aenter__"):
                db_session = await managed_ctx.__aenter__()
            else:
                db_session = managed_ctx

        try:
            stmt = select(UserMcpServer).where(
                UserMcpServer.user_id == self.context.user_id,
                UserMcpServer.is_enabled == True,
                UserMcpServer.server_type == "sse",
            )
            rows = await db_session.execute(stmt)
            servers = rows.scalars().all()
            for server in servers:
                if not server.sse_url:
                    continue
                disabled = set(server.disabled_tools or [])
                cached = server.tools_cache or []
                if tool_name in disabled:
                    continue
                if not any((item or {}).get("name") == tool_name for item in cached):
                    continue
                headers = await mcp_discovery_service._get_auth_headers(db_session, server)
                try:
                    return await mcp_client.call_tool(
                        server.sse_url,
                        tool_name,
                        arguments,
                        headers=headers,
                    )
                except Exception as exc:
                    logger.warning(
                        "remote mcp tool call failed name=%s server=%s err=%s",
                        tool_name,
                        server.name,
                        exc,
                    )
                    return {"error": f"Remote MCP tool '{tool_name}' failed: {exc}"}
        finally:
            if managed_ctx is not None and hasattr(managed_ctx, "__aexit__"):
                await managed_ctx.__aexit__(None, None, None)

        return {"error": f"Tool '{tool_name}' not found in local plugins or MCP servers"}

    def _to_jsonable(self, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, list):
            # MCP content block flattening
            if all(isinstance(item, dict) and "type" in item for item in value):
                text_parts: list[str] = []
                for item in value:
                    if item.get("type") == "text":
                        text_parts.append(str(item.get("text") or ""))
                if text_parts:
                    return "\n".join(part for part in text_parts if part)
            return [self._to_jsonable(item) for item in value]
        if isinstance(value, dict):
            return {str(k): self._to_jsonable(v) for k, v in value.items()}
        if hasattr(value, "model_dump"):
            try:
                return self._to_jsonable(value.model_dump())
            except Exception:
                return str(value)
        if hasattr(value, "__dict__"):
            try:
                return self._to_jsonable(vars(value))
            except Exception:
                return str(value)
        return str(value)

    def _build_wrapped_code(
        self,
        user_code: str,
        *,
        tool_plan_results: dict[str, Any] | None = None,
    ) -> str:
        results_json = json.dumps(
            tool_plan_results or {},
            ensure_ascii=False,
        )
        tool_results_block = (
            "import json\n"
            f"TOOL_PLAN_RESULTS = json.loads({results_json!r})\n"
        )
        return f"{_RUNTIME_PREAMBLE}\n{tool_results_block}\n{user_code}\n"

    def _format_execution_result(
        self,
        result: dict[str, Any],
        session_id: str,
        runtime_meta: dict[str, Any],
    ) -> dict[str, Any]:
        if "error" in result:
            return {
                "status": "failed",
                "session_id": session_id,
                "runtime": runtime_meta,
                "error": result.get("error"),
                "error_code": result.get("error_code"),
                "error_detail": result.get("error_detail"),
            }

        stdout = self._join_chunks(result.get("stdout"))
        stderr = self._join_chunks(result.get("stderr"))
        final_result = self._join_chunks(result.get("result"))
        exit_code = int(result.get("exit_code", 0) or 0)

        stdout_trimmed, stdout_truncated = self._truncate(stdout)
        stderr_trimmed, stderr_truncated = self._truncate(stderr)
        final_result_trimmed, result_truncated = self._truncate(final_result)

        return {
            "status": "success" if exit_code == 0 else "failed",
            "session_id": session_id,
            "runtime": runtime_meta,
            "exit_code": exit_code,
            "stdout": stdout_trimmed,
            "stderr": stderr_trimmed,
            "result": final_result_trimmed,
            "truncated": bool(
                stdout_truncated or stderr_truncated or result_truncated
            ),
        }

    def _build_runtime_meta(self, source: str, session_id: str) -> dict[str, Any]:
        return {
            "execution_id": uuid.uuid4().hex,
            "session_id": session_id,
            "code_sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
            "submitted_at": datetime.now(UTC).isoformat(),
        }

    def _join_chunks(self, value: Any) -> str:
        if isinstance(value, list):
            return "\n".join(str(item) for item in value)
        if value is None:
            return ""
        return str(value)

    def _truncate(self, text: str) -> tuple[str, bool]:
        if len(text) <= _MAX_RESULT_CHARS:
            return text, False
        return text[:_MAX_RESULT_CHARS] + "... (truncated)", True
