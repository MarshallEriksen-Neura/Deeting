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
_MAX_RUNTIME_TOOL_CALLS = 8
_RUNTIME_TOOL_CALL_MARKER = "__DEETING_TOOL_CALL_REQUEST__"
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
    class _DeetingHostToolCallSignal(BaseException):
        pass

    class DeetingRuntime:
        def __init__(self, context=None, tool_results=None, max_tool_calls=__MAX_RUNTIME_TOOL_CALLS__):
            self.version = "1.1.0"
            self.context = context or {}
            self._tool_results = list(tool_results or [])
            self._call_index = 0
            self._max_tool_calls = int(max_tool_calls or 0)

        def log(self, *args):
            print("[deeting.log]", *args)

        def section(self, title):
            print(f"\\n[deeting.section] {title}")

        def get_context(self):
            return self.context

        def call_tool(self, tool_name, **arguments):
            idx = self._call_index
            self._call_index += 1

            if idx < len(self._tool_results):
                return self._tool_results[idx]

            if idx >= self._max_tool_calls:
                raise RuntimeError("runtime tool call limit exceeded")

            payload = {
                "index": idx,
                "tool_name": str(tool_name or "").strip(),
                "arguments": arguments or {},
            }
            print("__RUNTIME_TOOL_CALL_MARKER__" + json.dumps(payload, ensure_ascii=False))
            raise _DeetingHostToolCallSignal(f"pending runtime tool call #{idx}")
    """
).replace("__MAX_RUNTIME_TOOL_CALLS__", str(_MAX_RUNTIME_TOOL_CALLS)).replace(
    "__RUNTIME_TOOL_CALL_MARKER__", _RUNTIME_TOOL_CALL_MARKER
)


class DeetingCoreSdkPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system.deeting_core_sdk",
            version="1.1.0",
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
                        "signatures, parameter docs, and python stubs. Use before "
                        "execute_code_plan."
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
                        "`deeting.log()`, `deeting.section()`, and `deeting.call_tool()`."
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
            parameter_docs = self._build_parameter_docs(tool)
            item = {
                "name": tool.name,
                "description": tool.description or "",
                "signature": self._build_signature(tool, parameter_docs),
                "python_stub": self._build_python_stub(tool, parameter_docs),
                "parameters": parameter_docs,
                "required_parameters": [
                    p["name"] for p in parameter_docs if p.get("required")
                ],
            }
            example_arguments = self._build_example_arguments(parameter_docs)
            if example_arguments:
                item["example_arguments"] = example_arguments
            if include_schema:
                item["input_schema"] = tool.input_schema
            items.append(item)
            if len(items) >= safe_limit:
                break

        return {
            "mode": "code_mode",
            "format_version": "sdk_toolcard.v2",
            "query": q,
            "count": len(items),
            "tools": items,
            "usage_hint": (
                "先根据参数文档和 python_stub 规划步骤，再调用 execute_code_plan 一次性执行。"
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

        try:
            timeout_value = int(execution_timeout or 30)
        except (TypeError, ValueError):
            timeout_value = 30

        runtime_context = self._build_runtime_context(
            workflow_context=__context__,
            runtime_meta=runtime_meta,
            final_session_id=final_session_id,
        )

        runtime_tool_results: list[Any] = []
        runtime_tool_trace: list[dict[str, Any]] = []

        for _ in range(_MAX_RUNTIME_TOOL_CALLS + 1):
            wrapped_code = self._build_wrapped_code(
                source,
                tool_plan_results=tool_plan_results,
                runtime_context=runtime_context,
                runtime_tool_results=runtime_tool_results,
            )

            result = await sandbox_manager.run_code(
                final_session_id,
                wrapped_code,
                language=normalized_language,
                execution_timeout=timeout_value,
            )

            runtime_tool_request = self._extract_runtime_tool_request(result)
            if not runtime_tool_request:
                if runtime_tool_trace:
                    runtime_meta["runtime_tool_calls"] = {
                        "count": len(runtime_tool_trace),
                        "calls": runtime_tool_trace,
                    }
                return self._format_execution_result(result, final_session_id, runtime_meta)

            if len(runtime_tool_results) >= _MAX_RUNTIME_TOOL_CALLS:
                runtime_meta["runtime_tool_calls"] = {
                    "count": len(runtime_tool_trace),
                    "calls": runtime_tool_trace,
                }
                return {
                    "status": "failed",
                    "runtime": runtime_meta,
                    "error": "runtime tool call limit exceeded",
                    "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_LIMIT",
                    "request": runtime_tool_request,
                }

            tool_name = str(runtime_tool_request.get("tool_name") or "").strip()
            if not tool_name:
                return {
                    "status": "failed",
                    "runtime": runtime_meta,
                    "error": "runtime tool call request missing tool_name",
                    "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_INVALID",
                    "request": runtime_tool_request,
                }
            if tool_name in {"search_sdk", "execute_code_plan"}:
                return {
                    "status": "failed",
                    "runtime": runtime_meta,
                    "error": f"runtime tool call '{tool_name}' is not allowed",
                    "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_INVALID",
                    "request": runtime_tool_request,
                }

            call_arguments = runtime_tool_request.get("arguments") or {}
            if not isinstance(call_arguments, dict):
                call_arguments = {}

            runtime_tool_result = await self._dispatch_real_tool(
                tool_name=tool_name,
                arguments=call_arguments,
                workflow_context=__context__,
            )
            normalized_tool_result = self._to_jsonable(runtime_tool_result)
            runtime_tool_results.append(normalized_tool_result)

            runtime_tool_trace.append(
                {
                    "index": int(runtime_tool_request.get("index", len(runtime_tool_results) - 1)),
                    "tool_name": tool_name,
                    "status": (
                        "failed"
                        if isinstance(normalized_tool_result, dict)
                        and bool(normalized_tool_result.get("error"))
                        else "success"
                    ),
                }
            )

        return {
            "status": "failed",
            "runtime": runtime_meta,
            "error": "runtime tool call loop exceeded",
            "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_LIMIT",
        }

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
        raw_user_id = self._context_attr(
            workflow_context, "user_id", self.context.user_id
        )
        if isinstance(raw_user_id, uuid.UUID):
            return raw_user_id
        return uuid.UUID(str(raw_user_id))

    def _resolve_session_id(
        self, *, explicit_session_id: str | None, workflow_context: Any | None
    ) -> str:
        if explicit_session_id:
            return explicit_session_id

        context_session_id = self._context_attr(workflow_context, "session_id")
        if context_session_id:
            return str(context_session_id)

        if self.context.session_id:
            return str(self.context.session_id)

        return f"user:{self.context.user_id}"

    def _build_signature(
        self,
        tool: ToolDefinition,
        parameter_docs: list[dict[str, Any]] | None = None,
    ) -> str:
        docs = parameter_docs if parameter_docs is not None else self._build_parameter_docs(tool)
        parts: list[str] = []
        for param in docs:
            name = str(param.get("name") or "")
            tp = str(param.get("type") or "any")
            if not name:
                continue
            is_required = bool(param.get("required"))
            fragment = f"{name}{'' if is_required else '?'}:{tp}"
            if (not is_required) and ("default" in param):
                fragment += f"={self._format_literal(param.get('default'))}"
            parts.append(fragment)
        return f"{tool.name}({', '.join(parts)})"

    def _build_parameter_docs(self, tool: ToolDefinition) -> list[dict[str, Any]]:
        schema = tool.input_schema if isinstance(tool.input_schema, dict) else {}
        properties = schema.get("properties") or {}
        required = set(schema.get("required") or [])

        docs: list[dict[str, Any]] = []
        for name, prop in properties.items():
            prop_schema = prop if isinstance(prop, dict) else {}
            doc: dict[str, Any] = {
                "name": name,
                "type": str(prop_schema.get("type", "any")),
                "python_type": self._json_schema_to_python_type(prop_schema),
                "required": name in required,
                "description": str(prop_schema.get("description") or ""),
            }
            if "default" in prop_schema:
                doc["default"] = self._to_jsonable(prop_schema.get("default"))
            enum_values = prop_schema.get("enum")
            if isinstance(enum_values, list) and enum_values:
                doc["enum"] = [self._to_jsonable(v) for v in enum_values]
            if "example" in prop_schema:
                doc["example"] = self._to_jsonable(prop_schema.get("example"))
            docs.append(doc)
        return docs

    def _json_schema_to_python_type(self, schema: dict[str, Any]) -> str:
        schema_type = schema.get("type")
        if isinstance(schema_type, list) and schema_type:
            mapped = [
                self._json_schema_to_python_type({"type": part})
                for part in schema_type
                if isinstance(part, str)
            ]
            merged = " | ".join(part for part in mapped if part)
            return merged or "Any"
        if schema_type == "string":
            return "str"
        if schema_type == "integer":
            return "int"
        if schema_type == "number":
            return "float"
        if schema_type == "boolean":
            return "bool"
        if schema_type == "array":
            items = schema.get("items")
            if isinstance(items, dict):
                return f"list[{self._json_schema_to_python_type(items)}]"
            return "list[Any]"
        if schema_type == "object":
            return "dict[str, Any]"
        return "Any"

    def _build_python_stub(
        self,
        tool: ToolDefinition,
        parameter_docs: list[dict[str, Any]],
    ) -> str:
        args: list[str] = []
        for param in parameter_docs:
            name = str(param.get("name") or "")
            if not name:
                continue
            python_type = str(param.get("python_type") or "Any")
            is_required = bool(param.get("required"))
            if is_required:
                args.append(f"{name}: {python_type}")
                continue

            if "default" in param:
                default_literal = self._format_literal(param.get("default"))
                args.append(f"{name}: {python_type} = {default_literal}")
            else:
                args.append(f"{name}: {python_type} | None = None")

        params = ", ".join(args)
        return f"def {tool.name}({params}) -> dict: ..."

    def _build_example_arguments(
        self,
        parameter_docs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        example: dict[str, Any] = {}
        for param in parameter_docs:
            name = str(param.get("name") or "")
            if not name:
                continue
            should_include = (
                bool(param.get("required"))
                or "default" in param
                or "example" in param
                or "enum" in param
            )
            if not should_include:
                continue
            example[name] = self._example_value_for_parameter(param)
        return example

    def _example_value_for_parameter(self, param: dict[str, Any]) -> Any:
        if "example" in param:
            return self._to_jsonable(param.get("example"))
        if "default" in param:
            return self._to_jsonable(param.get("default"))
        enum_values = param.get("enum")
        if isinstance(enum_values, list) and enum_values:
            return self._to_jsonable(enum_values[0])

        param_type = str(param.get("type") or "any")
        if param_type == "string":
            return "<string>"
        if param_type == "integer":
            return 0
        if param_type == "number":
            return 0.0
        if param_type == "boolean":
            return False
        if param_type == "array":
            return []
        if param_type == "object":
            return {}
        return None

    def _format_literal(self, value: Any) -> str:
        normalized = self._to_jsonable(value)
        if normalized is None:
            return "None"
        try:
            return json.dumps(normalized, ensure_ascii=False)
        except Exception:
            return repr(normalized)

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

    def _extract_runtime_tool_request(self, result: dict[str, Any]) -> dict[str, Any] | None:
        for key in ("stdout", "stderr", "result"):
            payload = self._extract_runtime_tool_request_from_text(
                self._join_chunks(result.get(key))
            )
            if payload is not None:
                return payload
        return None

    def _extract_runtime_tool_request_from_text(
        self,
        text: str | None,
    ) -> dict[str, Any] | None:
        if not text:
            return None
        for line in reversed(str(text).splitlines()):
            raw = line.strip()
            if not raw.startswith(_RUNTIME_TOOL_CALL_MARKER):
                continue
            payload_str = raw[len(_RUNTIME_TOOL_CALL_MARKER) :].strip()
            if not payload_str:
                return {}
            try:
                payload = json.loads(payload_str)
            except Exception:
                return {}
            if isinstance(payload, dict):
                return payload
            return {}
        return None

    def _context_attr(
        self,
        workflow_context: Any | None,
        key: str,
        default: Any = None,
    ) -> Any:
        if workflow_context is None:
            return default
        if isinstance(workflow_context, dict):
            if key in workflow_context:
                return workflow_context.get(key, default)
            nested = workflow_context.get("context")
            if isinstance(nested, dict):
                return nested.get(key, default)
            if nested is not None:
                return getattr(nested, key, default)
            return default
        return getattr(workflow_context, key, default)

    def _context_ns_value(
        self,
        workflow_context: Any | None,
        namespace: str,
        key: str,
        default: Any = None,
    ) -> Any:
        if workflow_context is None:
            return default
        if hasattr(workflow_context, "get"):
            try:
                return workflow_context.get(namespace, key, default)
            except TypeError:
                pass
            except Exception:
                return default
        if isinstance(workflow_context, dict):
            namespace_obj = workflow_context.get(namespace)
            if isinstance(namespace_obj, dict):
                return namespace_obj.get(key, default)
            nested = workflow_context.get("context")
            if hasattr(nested, "get"):
                try:
                    return nested.get(namespace, key, default)
                except Exception:
                    return default
        return default

    def _build_runtime_context(
        self,
        *,
        workflow_context: Any | None,
        runtime_meta: dict[str, Any],
        final_session_id: str,
    ) -> dict[str, Any]:
        channel = self._context_attr(workflow_context, "channel")
        channel_value = getattr(channel, "value", channel)
        raw_scopes = self._context_ns_value(workflow_context, "auth", "scopes")
        if raw_scopes is None:
            raw_scopes = self._context_ns_value(workflow_context, "external_auth", "scopes")

        scopes = (
            [str(item) for item in raw_scopes if item is not None]
            if isinstance(raw_scopes, list)
            else []
        )

        payload = {
            "runtime": runtime_meta,
            "identity": {
                "user_id": str(
                    self._context_attr(workflow_context, "user_id", self.context.user_id)
                ),
                "tenant_id": self._context_attr(workflow_context, "tenant_id"),
                "api_key_id": self._context_attr(workflow_context, "api_key_id"),
                "session_id": final_session_id,
            },
            "request": {
                "trace_id": self._context_attr(workflow_context, "trace_id"),
                "channel": channel_value,
                "capability": self._context_attr(workflow_context, "capability"),
                "requested_model": self._context_attr(workflow_context, "requested_model"),
                "client_ip": self._context_attr(workflow_context, "client_ip"),
                "user_agent": self._context_attr(workflow_context, "user_agent"),
            },
            "permissions": {
                "scopes": scopes,
                "allowed_models": self._context_ns_value(
                    workflow_context, "external_auth", "allowed_models"
                ),
            },
            "limits": {
                "rate_limit_rpm": self._context_ns_value(
                    workflow_context, "external_auth", "rate_limit_rpm"
                ),
                "budget_limit": self._context_ns_value(
                    workflow_context, "external_auth", "budget_limit"
                ),
                "budget_used": self._context_ns_value(
                    workflow_context, "external_auth", "budget_used"
                ),
            },
            "routing": {
                "provider": self._context_ns_value(workflow_context, "routing", "provider"),
                "preset_id": self._context_ns_value(workflow_context, "routing", "preset_id"),
                "preset_item_id": self._context_ns_value(
                    workflow_context, "routing", "preset_item_id"
                ),
                "provider_model_id": self._context_ns_value(
                    workflow_context, "routing", "provider_model_id"
                ),
            },
        }
        return self._prune_none(self._to_jsonable(payload))

    def _prune_none(self, value: Any) -> Any:
        if isinstance(value, dict):
            pruned = {
                str(k): self._prune_none(v)
                for k, v in value.items()
                if v is not None
            }
            return {
                k: v
                for k, v in pruned.items()
                if not (
                    v is None
                    or v == {}
                    or v == []
                )
            }
        if isinstance(value, list):
            return [self._prune_none(v) for v in value if v is not None]
        return value

    def _build_wrapped_code(
        self,
        user_code: str,
        *,
        tool_plan_results: dict[str, Any] | None = None,
        runtime_context: dict[str, Any] | None = None,
        runtime_tool_results: list[Any] | None = None,
    ) -> str:
        context_json = json.dumps(
            runtime_context or {},
            ensure_ascii=False,
        )
        results_json = json.dumps(
            tool_plan_results or {},
            ensure_ascii=False,
        )
        runtime_tool_results_json = json.dumps(
            runtime_tool_results or [],
            ensure_ascii=False,
        )
        runtime_block = (
            "import json\n"
            f"RUNTIME_CONTEXT = json.loads({context_json!r})\n"
            f"TOOL_PLAN_RESULTS = json.loads({results_json!r})\n"
            f"RUNTIME_TOOL_RESULTS = json.loads({runtime_tool_results_json!r})\n"
            "deeting = DeetingRuntime(context=RUNTIME_CONTEXT, tool_results=RUNTIME_TOOL_RESULTS)\n"
        )
        return f"{_RUNTIME_PREAMBLE}\n{runtime_block}\n{user_code}\n"

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
