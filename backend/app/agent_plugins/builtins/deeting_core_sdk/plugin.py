import ast
import hashlib
import inspect
import json
import keyword
import logging
import re
import uuid
from pathlib import Path
from datetime import UTC, datetime
from time import perf_counter
from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.config import settings
from app.core.metrics import record_code_mode_execution, record_code_mode_tool_call
from app.core.sandbox.manager import sandbox_manager
from app.repositories.code_mode_execution_repository import CodeModeExecutionRepository
from app.schemas.tool import ToolDefinition
from app.services.assistant.activation_contract import (
    build_assistant_activation_payload,
    build_assistant_consult_payload,
    build_assistant_deactivation_payload,
)
from app.services.assistant.assistant_retrieval_service import AssistantRetrievalService
from app.services.assistant.skill_resolver import (
    resolve_skill_refs,
    skill_tools_to_openai_format,
)
from app.services.code_mode.runtime_bridge_token_service import (
    RuntimeBridgeClaims,
    runtime_bridge_token_service,
)
from app.services.code_mode import protocol as code_mode_protocol
from app.services.code_mode import tracing as code_mode_tracing
from app.services.runtime import (
    DEFAULT_BRIDGE_EXECUTION_TOKEN_HEADER,
    build_runtime_preamble,
)
from app.services.tools.tool_context_service import tool_context_service

logger = logging.getLogger(__name__)

_MAX_SEARCH_LIMIT = 20
_MAX_CODE_CHARS = 12000
_MAX_RESULT_CHARS = 4000
_MAX_LOG_SOURCE_PREVIEW_CHARS = 3000
_MAX_LOG_IO_PREVIEW_CHARS = 600
_MAX_TOOL_PLAN_STEPS = 20
_MAX_RUNTIME_TOOL_CALLS = 8
_MAX_RUNTIME_SDK_STUB_TOOLS = 80
_MAX_RUNTIME_SDK_STUB_CHARS = 40000
_MAX_RUNTIME_TOOL_TRACE_ERROR_CHARS = 240
_RUNTIME_PROTOCOL_VERSION = code_mode_protocol.RUNTIME_PROTOCOL_VERSION
_SDK_TOOLCARD_FORMAT_VERSION = code_mode_protocol.SDK_TOOLCARD_FORMAT_VERSION
_EXECUTION_FORMAT_VERSION = code_mode_protocol.EXECUTION_FORMAT_VERSION
_RUNTIME_TOOL_CALL_MARKER = code_mode_protocol.RUNTIME_TOOL_CALL_MARKER
_RUNTIME_RENDER_BLOCK_MARKER = code_mode_protocol.RUNTIME_RENDER_BLOCK_MARKER
_SEARCH_SDK_CONTEXT_NAMESPACE = "code_mode"
_SEARCH_SDK_CONTEXT_KEY = "search_sdk_snapshot"
_BRIDGE_EXECUTION_TOKEN_HEADER = DEFAULT_BRIDGE_EXECUTION_TOKEN_HEADER
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

_RUNTIME_PREAMBLE = build_runtime_preamble(
    max_tool_calls=_MAX_RUNTIME_TOOL_CALLS,
    bridge_execution_token_header=_BRIDGE_EXECUTION_TOKEN_HEADER,
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
                        "execute_code_plan. Prefer calling tools by generated stubs "
                        "or `deeting.call_tool(name, **kwargs)`."
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
                    "name": "activate_assistant",
                    "description": (
                        "Activate an assistant explicitly for the current request-scoped "
                        "agent loop. This switches persona context only after an explicit "
                        "activation call."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "assistant_id": {
                                "type": "string",
                                "description": "Assistant id returned by consult_expert_network.",
                            },
                            "reason": {
                                "type": "string",
                                "description": "Optional reason for the activation decision.",
                            },
                        },
                        "required": ["assistant_id"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "deactivate_assistant",
                    "description": (
                        "Deactivate the current request-scoped assistant and return to "
                        "the default base assistant context."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "reason": {
                                "type": "string",
                                "description": "Optional reason for the deactivation.",
                            }
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "sys_refine_asset_metadata",
                    "description": "System-internal: Use LLM to extract structured metadata from raw text for a new asset.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "prompt": {"type": "string"},
                            "asset_type": {"type": "string", "enum": ["assistant", "skill"]}
                        },
                        "required": ["prompt", "asset_type"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "sys_submit_onboarding_request",
                    "description": "System-internal: Submit a new asset for onboarding. Host decides to approve or review.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "asset_type": {"type": "string", "enum": ["assistant", "skill"]},
                            "payload": {"type": "object"},
                            "source_url": {"type": "string"}
                        },
                        "required": ["asset_type", "payload"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "execute_code_plan",
                    "description": (
                        "Execute a Python code plan in sandbox. Runtime exposes "
                        "`deeting.log()`, `deeting.section()`, and `deeting.call_tool()`. "
                        "SDK tool stubs are auto-injected based on your code: use "
                        "`from deeting_sdk import <tool_name>` directly without calling "
                        "search_sdk first (search_sdk is optional for discovery). "
                        "Important: call tools with keyword args "
                        "(`deeting.call_tool('tavily-search', query='...', max_results=5)`), "
                        "not positional dict args. Generate one coherent script, and always "
                        "emit final structured output via `deeting.log(json.dumps(result, ensure_ascii=False))` "
                        "instead of relying on top-level `return`."
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

        items: list[dict[str, Any]] | None = []
        for tool in tools:
            if tool.name in {"search_sdk", "execute_code_plan"}:
                continue
            
            # Defensive backfilling: if some fields are missing (stale index), 
            # try to fetch from local plugin registry.
            if not tool.output_description or not tool.output_schema:
                self._backfill_tool_metadata(tool)

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

        tool_names = [str(item.get("name") or "").strip() for item in items]
        self._store_search_sdk_snapshot(
            __context__,
            query=q,
            tool_names=tool_names,
        )

        return {
            "mode": "code_mode",
            "format_version": _SDK_TOOLCARD_FORMAT_VERSION,
            "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
            "query": q,
            "count": len(items),
            "tools": items,
            "usage_hint": (
                "先根据参数文档和 python_stub 规划步骤，再调用 execute_code_plan 一次性执行。"
                "脚本内优先 `from deeting_sdk import tool_name` 或 "
                "`deeting.call_tool(name, **kwargs)`；不要写 "
                "`deeting.call_tool(name, { ... })`。最后请用 "
                "`deeting.log(json.dumps(result, ensure_ascii=False))` 输出结构化结果。"
            ),
        }

    async def handle_consult_expert_network(
        self,
        intent_query: str,
        k: int = 3,
        confidence: float = 1.0,
        __context__: Any | None = None,
    ) -> dict[str, Any]:
        q = str(intent_query or "").strip()
        if not q:
            return {
                "error": "intent_query is required",
                "error_code": "ASSISTANT_CONSULT_EMPTY_QUERY",
            }

        try:
            safe_limit = max(1, min(int(k or 3), 8))
        except (TypeError, ValueError):
            safe_limit = 3

        workflow_context = __context__ if __context__ is not None else None
        db_session = getattr(workflow_context, "db_session", None)
        if db_session is None:
            return {
                "error": "assistant consult requires db_session context",
                "error_code": "ASSISTANT_CONSULT_CONTEXT_MISSING",
            }

        retrieval = AssistantRetrievalService(db_session)
        try:
            raw_candidates = await retrieval.search_candidates(q, limit=safe_limit)
        except Exception as exc:
            logger.error("consult_expert_network failed: %s", exc, exc_info=True)
            return {
                "error": f"consult_expert_network failed: {exc}",
                "error_code": "ASSISTANT_CONSULT_FAILED",
            }

        candidates: list[dict[str, Any]] = []
        for candidate in raw_candidates or []:
            if not isinstance(candidate, dict):
                continue
            assistant_id = str(candidate.get("assistant_id") or "").strip()
            name = str(candidate.get("name") or "").strip()
            if not assistant_id or not name:
                continue
            candidates.append(
                {
                    "assistant_id": assistant_id,
                    "name": name,
                    "summary": candidate.get("summary"),
                    "score": candidate.get("score"),
                }
            )

        payload = build_assistant_consult_payload(
            candidates=candidates,
            reason=(
                "Search expert assistants by intent and activate explicitly if needed."
            ),
        )
        if workflow_context is not None and hasattr(workflow_context, "set"):
            try:
                workflow_context.set("assistant_activation", "last_consult", payload)
            except Exception:
                pass
        return payload

    async def handle_activate_assistant(
        self,
        assistant_id: str,
        reason: str | None = None,
        __context__: Any | None = None,
    ) -> dict[str, Any]:
        normalized_assistant_id = str(assistant_id or "").strip()
        if not normalized_assistant_id:
            return {
                "error": "assistant_id is required",
                "error_code": "ASSISTANT_ACTIVATION_MISSING_ID",
            }

        workflow_context = __context__ if __context__ is not None else None
        db_session = getattr(workflow_context, "db_session", None)
        if db_session is None:
            return {
                "error": "assistant activation requires db_session context",
                "error_code": "ASSISTANT_ACTIVATION_CONTEXT_MISSING",
            }

        from sqlalchemy import select
        from app.models.assistant import Assistant, AssistantVersion

        stmt = (
            select(
                AssistantVersion.system_prompt,
                AssistantVersion.skill_refs,
                AssistantVersion.name,
            )
            .join(Assistant, Assistant.current_version_id == AssistantVersion.id)
            .where(Assistant.id == normalized_assistant_id)
        )
        result = await db_session.execute(stmt)
        row = result.first()
        if not row:
            return {
                "error": f"assistant '{normalized_assistant_id}' not found",
                "error_code": "ASSISTANT_NOT_FOUND",
            }

        system_prompt, skill_refs, assistant_name = row[0], row[1], row[2]
        resolved_skill_tools = await resolve_skill_refs(skill_refs or [])
        skill_tools = skill_tools_to_openai_format(resolved_skill_tools)
        payload = build_assistant_activation_payload(
            assistant_id=normalized_assistant_id,
            assistant_name=str(assistant_name or "Assistant"),
            system_prompt=str(system_prompt or ""),
            skill_tools=skill_tools,
            reason=reason or "Explicit assistant activation requested by the model.",
        )
        if workflow_context is not None and hasattr(workflow_context, "set"):
            try:
                workflow_context.set("assistant_activation", "pending", payload)
            except Exception:
                pass
        return payload

    async def handle_deactivate_assistant(
        self,
        reason: str | None = None,
        __context__: Any | None = None,
    ) -> dict[str, Any]:
        workflow_context = __context__ if __context__ is not None else None
        active_payload = None
        if workflow_context is not None and hasattr(workflow_context, "get"):
            try:
                active_payload = workflow_context.get("assistant_activation", "active")
            except Exception:
                active_payload = None

        payload = build_assistant_deactivation_payload(
            assistant_id=(active_payload or {}).get("assistant_id")
            if isinstance(active_payload, dict)
            else None,
            assistant_name=(active_payload or {}).get("assistant_name")
            if isinstance(active_payload, dict)
            else None,
            reason=reason or "Explicit assistant deactivation requested by the model.",
        )
        if workflow_context is not None and hasattr(workflow_context, "set"):
            try:
                workflow_context.set("assistant_activation", "pending", payload)
            except Exception:
                pass
        return payload

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
        request_language = (language or "python").strip().lower() or "python"
        safe_tool_plan = tool_plan if isinstance(tool_plan, list) else []
        request_started_monotonic = perf_counter()
        request_trace_id = str(self._context_attr(__context__, "trace_id", "") or "").strip()
        execution_span = code_mode_tracing.begin_span(
            "code_mode.execution",
            trace_id=request_trace_id or None,
            attributes={
                "code_mode.code_chars": len(source),
                "code_mode.tool_plan_steps": len(safe_tool_plan),
            },
        )

        async def _finalize_response(
            payload: dict[str, Any],
            *,
            runtime_meta_override: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            result_payload = self._finalize_code_mode_response(
                payload,
                workflow_context=__context__,
                request_started_monotonic=request_started_monotonic,
                runtime_meta_override=runtime_meta_override,
                code_chars=len(source),
                tool_plan_steps=len(safe_tool_plan),
            )
            await self._persist_execution_record(
                response=result_payload,
                source_code=source,
                language=request_language,
                tool_plan=safe_tool_plan,
                workflow_context=__context__,
                code_chars=len(source),
                tool_plan_steps=len(safe_tool_plan),
            )
            if execution_span.duration_ms is None:
                span_status = "ok" if result_payload.get("status") == "success" else "error"
                if span_status != "ok":
                    error_text = result_payload.get("error")
                    if isinstance(error_text, str) and error_text:
                        execution_span.error = error_text
                execution_span.finish(status=span_status)
            return result_payload

        if not source:
            return await _finalize_response({
                "status": "failed",
                "format_version": _EXECUTION_FORMAT_VERSION,
                "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                "error": "code is required",
                "error_code": "CODE_MODE_EMPTY_CODE",
            })
        if len(source) > _MAX_CODE_CHARS:
            return await _finalize_response({
                "status": "failed",
                "format_version": _EXECUTION_FORMAT_VERSION,
                "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                "error": f"code is too long (> {_MAX_CODE_CHARS} chars)",
                "error_code": "CODE_MODE_CODE_TOO_LONG",
            })

        normalized_language = request_language
        if normalized_language != "python":
            return await _finalize_response({
                "status": "failed",
                "format_version": _EXECUTION_FORMAT_VERSION,
                "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                "error": f"unsupported language: {language}",
                "error_code": "CODE_MODE_UNSUPPORTED_LANGUAGE",
            })

        violations = self._validate_python_code(source)
        if violations:
            return await _finalize_response({
                "status": "failed",
                "format_version": _EXECUTION_FORMAT_VERSION,
                "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                "error": "code validation failed",
                "error_code": "CODE_MODE_VALIDATION_FAILED",
                "violations": violations,
            })

        final_session_id = self._resolve_session_id(
            explicit_session_id=session_id, workflow_context=__context__
        )
        runtime_meta = self._build_runtime_meta(
            source,
            final_session_id,
            workflow_context=__context__,
        )
        has_search_snapshot = self._has_search_sdk_snapshot(__context__)
        allowed_runtime_tools = self._resolve_search_allowed_tools(__context__)
        if has_search_snapshot:
            runtime_meta["search_sdk"] = {
                "tool_count": len(allowed_runtime_tools),
                "tool_names": sorted(allowed_runtime_tools),
            }
        runtime_meta["trace_id"] = execution_span.trace_id
        runtime_meta["execution_span_id"] = execution_span.span_id
        started_monotonic = perf_counter()
        source_preview, source_preview_truncated = self._truncate_for_log(
            source, limit=_MAX_LOG_SOURCE_PREVIEW_CHARS
        )
        logger.info(
            "code_mode_source",
            extra={
                "execution_id": str(runtime_meta.get("execution_id") or "").strip(),
                "trace_id": str(runtime_meta.get("trace_id") or "").strip(),
                "session_id": final_session_id,
                "language": normalized_language,
                "code_chars": len(source),
                "tool_plan_steps": len(safe_tool_plan),
                "code_preview": source_preview,
                "code_preview_truncated": source_preview_truncated,
            },
        )

        if dry_run:
            plan_validation = self._validate_tool_plan(safe_tool_plan)
            plan_validation.extend(
                self._validate_tool_plan_allowed_tools(
                    safe_tool_plan,
                    allowed_tools=allowed_runtime_tools,
                    enforce_snapshot=has_search_snapshot,
                )
            )
            plan_validation = sorted(set(plan_validation))
            self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
            return await _finalize_response(
                {
                "status": "dry_run",
                "format_version": _EXECUTION_FORMAT_VERSION,
                "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
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
                },
                runtime_meta_override=runtime_meta,
            )

        plan_validation = self._validate_tool_plan(safe_tool_plan)
        plan_validation.extend(
            self._validate_tool_plan_allowed_tools(
                safe_tool_plan,
                allowed_tools=allowed_runtime_tools,
                enforce_snapshot=has_search_snapshot,
            )
        )
        plan_validation = sorted(set(plan_validation))
        if plan_validation:
            self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
            return await _finalize_response(
                {
                "status": "failed",
                "format_version": _EXECUTION_FORMAT_VERSION,
                "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                "runtime": runtime_meta,
                "error": "tool_plan validation failed",
                "error_code": "CODE_MODE_TOOL_PLAN_INVALID",
                "violations": plan_validation,
                },
                runtime_meta_override=runtime_meta,
            )

        tool_plan_results: dict[str, Any] = {}
        if safe_tool_plan:
            with execution_span.child(
                "code_mode.tool_plan",
                attributes={"code_mode.tool_plan_steps": len(safe_tool_plan)},
            ) as tool_plan_span:
                plan_execution = await self._execute_tool_plan(
                    safe_tool_plan, workflow_context=__context__
                )
                tool_plan_span.set_attribute(
                    "code_mode.tool_plan_status",
                    str(plan_execution.get("status") or "unknown"),
                )
            runtime_meta["tool_plan"] = plan_execution.get("summary", {})
            if plan_execution.get("status") == "failed":
                self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
                return await _finalize_response(
                    {
                    "status": "failed",
                    "format_version": _EXECUTION_FORMAT_VERSION,
                    "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                    "runtime": runtime_meta,
                    "error": plan_execution.get("error"),
                    "error_code": "CODE_MODE_TOOL_PLAN_FAILED",
                    "steps": plan_execution.get("steps", []),
                    },
                    runtime_meta_override=runtime_meta,
                )
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
        runtime_sdk_bundle = await self._build_runtime_sdk_bundle(
            workflow_context=__context__,
            source_code=source,
            allowed_tool_names=allowed_runtime_tools,
        )
        if runtime_sdk_bundle:
            runtime_meta["sdk_stub"] = {
                "module": runtime_sdk_bundle.get("module_name"),
                "tool_count": int(runtime_sdk_bundle.get("tool_count") or 0),
                "pyi_chars": len(str(runtime_sdk_bundle.get("pyi") or "")),
            }
            if not has_search_snapshot:
                auto_tool_names = self._extract_sdk_tool_names(runtime_sdk_bundle)
                if auto_tool_names:
                    self._store_search_sdk_snapshot(
                        __context__,
                        query="(auto-discovered from code)",
                        tool_names=auto_tool_names,
                    )
                    has_search_snapshot = True
                    allowed_runtime_tools = self._normalize_tool_name_set(auto_tool_names)
                    runtime_meta["sdk_stub"]["auto_discovered"] = True
                    runtime_meta["sdk_stub"]["available_tools"] = sorted(auto_tool_names)
        bridge_context = await self._issue_runtime_bridge_context(
            workflow_context=__context__,
            runtime_meta=runtime_meta,
            final_session_id=final_session_id,
        )
        has_bridge = False
        if bridge_context:
            runtime_context["bridge"] = bridge_context
            has_bridge = True
            try:
                await runtime_bridge_token_service.store_context(
                    bridge_context.get("execution_token", ""),
                    runtime_context,
                )
            except Exception:
                has_bridge = False

        runtime_tool_results: list[Any] = []
        runtime_tool_trace: list[dict[str, Any]] = []
        runtime_render_blocks: list[dict[str, Any]] = []

        # Always keep marker restart attempts available.
        # Bridge mode should be fast-path (usually one run), but if bridge call
        # fails inside sandbox and runtime falls back to marker mode, host side
        # still needs subsequent attempts to dispatch and replay.
        max_attempts = _MAX_RUNTIME_TOOL_CALLS + 1

        # Result accumulation
        all_stdout_chunks = []
        all_stderr_chunks = []

        for attempt in range(max_attempts):
            is_reexecution = attempt > 0
            wrapped_code = self._build_wrapped_code(
                source,
                tool_plan_results=tool_plan_results,
                runtime_context=runtime_context,
                runtime_tool_results=runtime_tool_results,
                runtime_sdk_bundle=runtime_sdk_bundle,
                lazy_context=has_bridge,
                is_reexecution=is_reexecution,
            )

            with execution_span.child(
                "code_mode.sandbox.run",
                attributes={
                    "code_mode.sandbox_attempt": attempt + 1,
                    "code_mode.execution_timeout": timeout_value,
                    "code_mode.execution_mode": "bridge" if has_bridge else "marker",
                },
            ) as sandbox_span:
                # Current attempt state
                current_stdout = []
                current_stderr = []
                current_result = []
                exit_code = 0
                
                async for chunk in sandbox_manager.run_code_stream(
                    final_session_id,
                    wrapped_code,
                    language=normalized_language,
                    execution_timeout=timeout_value,
                ):
                    if "error" in chunk:
                        return await _finalize_response({
                            "status": "error",
                            "error": chunk["error"],
                            "error_code": chunk.get("error_code")
                        })
                    
                    if chunk["type"] == "stdout":
                        text = chunk.get("data") or chunk.get("content") or ""
                        current_stdout.append(text)
                        # 实时推送 stdout 到前端控制台
                        if __context__ and hasattr(__context__, "emit_blocks"):
                            __context__.emit_blocks([{
                                "type": "console_log",
                                "stream": "stdout",
                                "content": text
                            }])
                    
                    elif chunk["type"] == "stderr":
                        text = chunk.get("data") or chunk.get("content") or ""
                        current_stderr.append(text)
                        # 实时推送 stderr 到前端控制台
                        if __context__ and hasattr(__context__, "emit_blocks"):
                            __context__.emit_blocks([{
                                "type": "console_log",
                                "stream": "stderr",
                                "content": text
                            }])
                    
                    elif chunk["type"] == "exit":
                        exit_code = chunk.get("exit_code", 0)
                        current_result = chunk.get("result", [])

                # Merge current attempt into total history
                all_stdout_chunks.extend(current_stdout)
                all_stderr_chunks.extend(current_stderr)

                # Prepare result dict for marker extraction
                attempt_result = {
                    "stdout": current_stdout,
                    "stderr": current_stderr,
                    "result": current_result,
                    "exit_code": exit_code
                }

                sandbox_span.set_attribute("code_mode.sandbox_exit_code", int(exit_code or 0))
            
            # Collect render blocks
            runtime_render_blocks.extend(self._extract_runtime_render_blocks(attempt_result))

            # Look for tool marker in the CURRENT attempt ONLY
            runtime_tool_request = self._extract_runtime_tool_request(attempt_result)
            
            if runtime_tool_request:
                # 1. Host-side tool execution
                if has_bridge:
                    # Switch to marker mode for subsequent steps
                    has_bridge = False
                
                tool_name = runtime_tool_request.get("tool_name")
                arguments = runtime_tool_request.get("arguments", {})
                
                # Execute the real tool implementation (will use packages/ if applicable)
                tool_result = await self._dispatch_real_tool(
                    tool_name=tool_name,
                    arguments=arguments,
                    workflow_context=__context__
                )
                
                # Feed the result back for the next attempt
                runtime_tool_results.append(tool_result)
                runtime_tool_trace.append({
                    "index": runtime_tool_request.get("index"),
                    "name": tool_name,
                    "arguments": arguments,
                    "result": tool_result
                })
                
                # Continue to the next attempt (re-run sandbox with result)
                continue
            
            # If no more tool requests, we are DONE
            final_output = {
                "stdout": all_stdout_chunks,
                "stderr": all_stderr_chunks,
                "result": current_result,
                "exit_code": exit_code,
                "truncated": False
            }
            
            if runtime_tool_trace:
                runtime_meta["runtime_tool_calls"] = {
                    "count": len(runtime_tool_trace),
                    "calls": runtime_tool_trace,
                }
            if runtime_render_blocks:
                runtime_meta["render_blocks"] = {
                    "count": len(runtime_render_blocks),
                    "blocks": runtime_render_blocks,
                }
            
            return await _finalize_response(
                self._format_execution_result(
                    final_output,
                        final_session_id,
                        runtime_meta,
                        started_monotonic=started_monotonic,
                        render_blocks=runtime_render_blocks,
                        runtime_sdk_bundle=runtime_sdk_bundle,
                    ),
                    runtime_meta_override=runtime_meta,
                )

            # --- Marker Mode Restart Loop (only reachable if has_bridge=False) ---
            if len(runtime_tool_results) >= _MAX_RUNTIME_TOOL_CALLS:
                runtime_meta["runtime_tool_calls"] = {
                    "count": len(runtime_tool_trace),
                    "calls": runtime_tool_trace,
                }
                self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
                return await _finalize_response(
                    {
                    "status": "failed",
                    "format_version": _EXECUTION_FORMAT_VERSION,
                    "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                    "runtime": runtime_meta,
                    "error": "runtime tool call limit exceeded",
                    "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_LIMIT",
                    "request": runtime_tool_request,
                    },
                    runtime_meta_override=runtime_meta,
                )

            tool_name = str(runtime_tool_request.get("tool_name") or "").strip()
            if not tool_name:
                self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
                return await _finalize_response(
                    {
                    "status": "failed",
                    "format_version": _EXECUTION_FORMAT_VERSION,
                    "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                    "runtime": runtime_meta,
                    "error": "runtime tool call request missing tool_name",
                    "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_INVALID",
                    "request": runtime_tool_request,
                    },
                    runtime_meta_override=runtime_meta,
                )
            if tool_name in {"search_sdk", "execute_code_plan"}:
                self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
                return await _finalize_response(
                    {
                    "status": "failed",
                    "format_version": _EXECUTION_FORMAT_VERSION,
                    "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                    "runtime": runtime_meta,
                    "error": f"runtime tool call '{tool_name}' is not allowed",
                    "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_INVALID",
                    "request": runtime_tool_request,
                    },
                    runtime_meta_override=runtime_meta,
                )
            # Check search snapshot but allow core system tools to always be reachable
            _core_whitelist = {"fetch_web_content", "search_knowledge", "add_knowledge_chunk", "crawl_website"}
            is_allowed = (not has_search_snapshot) or (tool_name in allowed_runtime_tools) or (tool_name in _core_whitelist)

            if not is_allowed:
                self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
                error_msg = f"runtime tool call '{tool_name}' is not in latest search_sdk results"
                if tool_name == "tavily-search":
                    error_msg += ". Please use 'fetch_web_content' for web scraping instead."
                
                return await _finalize_response(
                    {
                    "status": "failed",
                    "format_version": _EXECUTION_FORMAT_VERSION,
                    "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                    "runtime": runtime_meta,
                    "error": error_msg,
                    "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_INVALID",
                    "request": runtime_tool_request,
                    },
                    runtime_meta_override=runtime_meta,
                )

            call_arguments = runtime_tool_request.get("arguments") or {}
            if not isinstance(call_arguments, dict):
                call_arguments = {}

            dispatch_started = perf_counter()
            with execution_span.child(
                "code_mode.runtime_tool_call",
                attributes={"code_mode.tool_name": tool_name},
            ) as runtime_tool_span:
                runtime_tool_result = await self._dispatch_real_tool(
                    tool_name=tool_name,
                    arguments=call_arguments,
                    workflow_context=__context__,
                )
            dispatch_duration_ms = max(0, int((perf_counter() - dispatch_started) * 1000))
            normalized_tool_result = self._to_jsonable(runtime_tool_result)
            runtime_tool_results.append(normalized_tool_result)

            trace_status = "success"
            trace_error = None
            trace_error_code = None
            if isinstance(normalized_tool_result, dict) and bool(
                normalized_tool_result.get("error")
            ):
                trace_status = "failed"
                trace_error = str(normalized_tool_result.get("error") or "").strip()
                if len(trace_error) > _MAX_RUNTIME_TOOL_TRACE_ERROR_CHARS:
                    trace_error = (
                        trace_error[:_MAX_RUNTIME_TOOL_TRACE_ERROR_CHARS] + "... (truncated)"
                    )
                raw_error_code = normalized_tool_result.get("error_code")
                if isinstance(raw_error_code, str) and raw_error_code.strip():
                    trace_error_code = raw_error_code.strip()
            runtime_tool_span.set_attribute("code_mode.tool_status", trace_status)
            runtime_tool_span.set_attribute("code_mode.tool_duration_ms", dispatch_duration_ms)
            if trace_error_code:
                runtime_tool_span.set_attribute("code_mode.tool_error_code", trace_error_code)

            trace_entry: dict[str, Any] = {
                "index": int(runtime_tool_request.get("index", len(runtime_tool_results) - 1)),
                "tool_name": tool_name,
                "status": trace_status,
                "duration_ms": dispatch_duration_ms,
            }
            if trace_error:
                trace_entry["error"] = trace_error
            if trace_error_code:
                trace_entry["error_code"] = trace_error_code

            runtime_tool_trace.append(trace_entry)
            try:
                record_code_mode_tool_call(
                    tool_name=tool_name,
                    status=trace_status,
                    error_code=trace_error_code,
                )
            except Exception:
                pass

        self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
        return await _finalize_response(
            {
            "status": "failed",
            "format_version": _EXECUTION_FORMAT_VERSION,
            "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
            "runtime": runtime_meta,
            "error": "runtime tool call loop exceeded",
            "error_code": "CODE_MODE_RUNTIME_TOOL_CALL_LIMIT",
            },
            runtime_meta_override=runtime_meta,
        )

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
                    include_non_core_in_code_mode=True,
                )

        return await tool_context_service.build_tools(
            session=None,
            user_id=user_id,
            query=query,
            include_non_core_in_code_mode=True,
        )

    def _store_search_sdk_snapshot(
        self,
        workflow_context: Any | None,
        *,
        query: str,
        tool_names: list[str],
    ) -> None:
        if workflow_context is None:
            return

        normalized_tools = sorted(self._normalize_tool_name_set(tool_names))
        snapshot = {
            "query": str(query or "").strip(),
            "tool_names": normalized_tools,
            "tool_count": len(normalized_tools),
            "updated_at": datetime.now(UTC).isoformat(),
        }

        if hasattr(workflow_context, "set"):
            try:
                workflow_context.set(
                    _SEARCH_SDK_CONTEXT_NAMESPACE,
                    _SEARCH_SDK_CONTEXT_KEY,
                    snapshot,
                )
                return
            except Exception:
                pass

        if isinstance(workflow_context, dict):
            namespace_obj = workflow_context.get(_SEARCH_SDK_CONTEXT_NAMESPACE)
            if not isinstance(namespace_obj, dict):
                namespace_obj = {}
                workflow_context[_SEARCH_SDK_CONTEXT_NAMESPACE] = namespace_obj
            namespace_obj[_SEARCH_SDK_CONTEXT_KEY] = snapshot

    def _resolve_search_allowed_tools(self, workflow_context: Any | None) -> set[str]:
        snapshot = self._context_ns_value(
            workflow_context,
            _SEARCH_SDK_CONTEXT_NAMESPACE,
            _SEARCH_SDK_CONTEXT_KEY,
            None,
        )
        if not isinstance(snapshot, dict):
            return set()
        return self._normalize_tool_name_set(snapshot.get("tool_names"))

    def _has_search_sdk_snapshot(self, workflow_context: Any | None) -> bool:
        snapshot = self._context_ns_value(
            workflow_context,
            _SEARCH_SDK_CONTEXT_NAMESPACE,
            _SEARCH_SDK_CONTEXT_KEY,
            None,
        )
        return isinstance(snapshot, dict) and "tool_names" in snapshot

    def _normalize_tool_name_set(self, value: Any) -> set[str]:
        if not isinstance(value, (list, tuple, set)):
            return set()
        normalized: set[str] = set()
        for item in value:
            name = str(item or "").strip()
            if name:
                normalized.add(name)
        return normalized

    def _validate_tool_plan_allowed_tools(
        self,
        tool_plan: list[dict[str, Any]],
        *,
        allowed_tools: set[str] | None,
        enforce_snapshot: bool = False,
    ) -> list[str]:
        if not enforce_snapshot:
            return []
        violations: list[str] = []
        for idx, step in enumerate(tool_plan):
            if not isinstance(step, dict):
                continue
            tool_name = str(step.get("tool_name") or "").strip()
            if not tool_name:
                continue
            if tool_name not in allowed_tools:
                violations.append(
                    f"step[{idx}] tool_name '{tool_name}' is not in latest search_sdk results"
                )
        return violations

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

    def _backfill_tool_metadata(self, tool: ToolDefinition) -> None:
        """从实时插件注册表中回填元数据，防止向量索引过时。"""
        from app.services.agent.agent_service import agent_service
        
        # 遍历已激活或注册的工具列表
        source_tool = next((t for t in agent_service.tools if t.name == tool.name), None)
        if source_tool:
            if not tool.output_description and source_tool.output_description:
                tool.output_description = source_tool.output_description
            if not tool.output_schema and source_tool.output_schema:
                tool.output_schema = source_tool.output_schema
            if not tool.description and source_tool.description:
                tool.description = source_tool.description

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

        _, typed_dict_name = self._build_output_typed_dict(tool)
        return_type = typed_dict_name or "dict[str, Any]"
        return f"{tool.name}({', '.join(parts)}) -> {return_type}"

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

    def _build_output_typed_dict_name(self, tool_name: str) -> str:
        """Generate a TypedDict class name from tool name, e.g. 'tavily_search' -> 'TavilySearchResult'."""
        safe = self._safe_python_identifier(tool_name)
        if not safe:
            return ""
        parts = safe.split("_")
        pascal = "".join(part.capitalize() for part in parts if part)
        return f"{pascal}Result"

    def _build_output_typed_dict(
        self,
        tool: ToolDefinition,
    ) -> tuple[str, str]:
        """
        Generate a TypedDict class definition from output_schema.
        Returns (typed_dict_class_code, class_name) or ("", "") if not applicable.
        """
        schema = tool.output_schema
        if not isinstance(schema, dict):
            return "", ""
        props = schema.get("properties")
        if not isinstance(props, dict) or not props:
            return "", ""
        class_name = self._build_output_typed_dict_name(str(tool.name or ""))
        if not class_name:
            return "", ""
        required_keys = set(schema.get("required") or [])
        lines: list[str] = [f"class {class_name}(TypedDict, total=False):"]
        desc = tool.output_description or ""
        if desc:
            lines.append(f'    """{desc}"""')
        for key, prop_schema in props.items():
            if not isinstance(key, str) or not key.isidentifier():
                continue
            prop_def = prop_schema if isinstance(prop_schema, dict) else {}
            python_type = self._json_schema_to_python_type(prop_def)
            comment_parts: list[str] = []
            if key in required_keys:
                comment_parts.append("required")
            prop_desc = prop_def.get("description")
            if prop_desc:
                comment_parts.append(str(prop_desc))
            comment = f"  # {'; '.join(comment_parts)}" if comment_parts else ""
            lines.append(f"    {key}: {python_type}{comment}")
        if len(lines) <= 1:
            return "", ""
        return "\n".join(lines), class_name

    def _build_python_stub(
        self,
        tool: ToolDefinition,
        parameter_docs: list[dict[str, Any]],
        return_type_override: str | None = None,
        include_typed_dict: bool = True,
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
        
        typed_dict_code, typed_dict_name = self._build_output_typed_dict(tool)
        return_type = return_type_override or typed_dict_name or "dict[str, Any]"
        
        # Build enhanced Docstring for output awareness
        doc_lines = [f'"""{tool.description or ""}']
        output_info = tool.output_description or ""
        if not output_info and tool.output_schema:
            props = tool.output_schema.get("properties", {})
            if props:
                keys = ", ".join([f"'{k}'" for k in props.keys()])
                output_info = f"Returns a dict with keys: {keys}."
        
        if output_info:
            doc_lines.append("")
            doc_lines.append(f"Returns:")
            doc_lines.append(f"    {return_type}: {output_info}")
        
        doc_lines.append('"""')
        indent = "    "
        docstring = "\n".join([f"{indent}{line}" if line else "" for line in doc_lines])

        func_stub = f"def {tool.name}({params}) -> {return_type}:\n{docstring}\n{indent}..."
        if include_typed_dict and typed_dict_code:
            return f"{typed_dict_code}\n\n{func_stub}"
        return func_stub

    async def _build_runtime_sdk_bundle(
        self,
        *,
        workflow_context: Any | None,
        source_code: str,
        allowed_tool_names: set[str] | None = None,
    ) -> dict[str, Any] | None:
        try:
            user_id = self._resolve_user_id(workflow_context)
        except Exception:
            return None

        query = (source_code or "").strip()
        if not query:
            query = "code mode execution"
        query = query[:2000]

        try:
            tools = await self._build_tool_candidates(user_id=user_id, query=query)
        except Exception as exc:
            logger.debug("build runtime sdk bundle skipped: %s", exc)
            return None

        filtered_tools: list[ToolDefinition] = []
        seen_names: set[str] = set()
        allowed_name_set = self._normalize_tool_name_set(allowed_tool_names or [])
        for tool in tools:
            name = str(getattr(tool, "name", "") or "").strip()
            if not name or name in {"search_sdk", "execute_code_plan"}:
                continue
            if allowed_name_set and name not in allowed_name_set:
                continue
            if name in seen_names:
                continue
            seen_names.add(name)
            filtered_tools.append(tool)

        if not filtered_tools:
            return None

        pyi_content, py_content, tool_count = self._render_runtime_sdk_module(
            filtered_tools
        )
        if not pyi_content or not py_content or tool_count <= 0:
            return None

        return {
            "module_name": "deeting_sdk",
            "tool_count": tool_count,
            "pyi": pyi_content,
            "py": py_content,
        }

    def _render_runtime_sdk_module(
        self,
        tools: list[ToolDefinition],
    ) -> tuple[str, str, int]:
        selected = list(tools[:_MAX_RUNTIME_SDK_STUB_TOOLS])
        if not selected:
            return "", "", 0

        # Build dynamic tool -> pkg mapping from extra_meta
        tool_to_pkg = {}
        for t in selected:
            if t.extra_meta and "pkg_name" in t.extra_meta:
                tool_to_pkg[t.name] = t.extra_meta["pkg_name"]

        while selected:
            pyi_content, py_content = self._build_runtime_sdk_module_content(
                selected, 
                tool_to_pkg=tool_to_pkg
            )
            if (
                len(pyi_content) <= _MAX_RUNTIME_SDK_STUB_CHARS
                and len(py_content) <= _MAX_RUNTIME_SDK_STUB_CHARS
            ):
                return pyi_content, py_content, len(selected)
            selected = selected[:-1]

        return "", "", 0

    def _build_runtime_sdk_module_content(
        self,
        tools: list[ToolDefinition],
        tool_to_pkg: dict[str, str] | None = None,
    ) -> tuple[str, str]:
        # 1. Generate PYI Interface
        pyi_lines = [
            "from typing import Any, TypedDict",
            "",
            "def call_tool(name: str, **kwargs: Any) -> dict[str, Any]: ...",
            "def available_tools() -> list[str]: ...",
            "",
        ]

        # 2. Generate PY Implementation
        import textwrap
        tool_to_pkg_json = json.dumps(tool_to_pkg or {}, ensure_ascii=False)
        py_content_head = textwrap.dedent(f"""
            from __future__ import annotations
            from typing import Any, TypedDict
            import os
            import sys
            import json
            import types
            from pathlib import Path

            def _runtime():
                import builtins
                runtime = getattr(builtins, "__DEETING_RUNTIME__", None)
                if runtime is None:
                    raise RuntimeError("deeting runtime is not available")
                return runtime

            TOOL_TO_PKG = json.loads({tool_to_pkg_json!r})

            def call_tool(name: str, **kwargs: Any) -> dict[str, Any]:
                # 1. Elegant Local-First execution (Two-Tier)
                try:
                    pkg_name = TOOL_TO_PKG.get(name)
                    if pkg_name:
                        import importlib
                        module = None
                        for ns in ["builtin_skills", "user_skills"]:
                            try:
                                module = importlib.import_module(f"{{ns}}.{{pkg_name}}.main")
                                break
                            except (ImportError, AttributeError):
                                continue
                        
                        if module:
                            handler = getattr(module, name, None)
                            if handler:
                                import asyncio
                                if asyncio.iscoroutinefunction(handler):
                                    return asyncio.run(handler(**kwargs))
                                return handler(**kwargs)
                except Exception as e:
                    print(f"[deeting.sdk] Local execution error for {{name}}: {{e}}", file=sys.stderr)

                # 2. Fallback to Bridge (for MCP / Remote tools)
                result = _runtime().call_tool(name, **kwargs)
                if isinstance(result, dict):
                    return result
                return {{"result": result}}
        """).strip()

        py_lines = [py_content_head, ""]
        declared_tools: list[str] = []

        for tool in tools:
            tool_name = str(tool.name or "").strip()
            if not tool_name: continue
            
            parameter_docs = self._build_parameter_docs(tool)
            py_func_name = self._safe_python_identifier(tool_name)
            if not py_func_name: continue

            declared_tools.append(tool_name)
            typed_dict_code, typed_dict_name = self._build_output_typed_dict(tool)
            return_type = typed_dict_name or "dict[str, Any]"

            if typed_dict_code:
                pyi_lines.append(typed_dict_code)
                pyi_lines.append("")
                py_lines.append(typed_dict_code)
                py_lines.append("")

            # Render PYI stub
            pyi_lines.append(self._build_python_stub(tool, parameter_docs, include_typed_dict=False))
            pyi_lines.append("")

            # Render PY implementation
            py_lines.append(self._render_tool_implementation(tool, parameter_docs, return_type))
            py_lines.append("")

        tool_list_literal = json.dumps(declared_tools, ensure_ascii=False)
        pyi_lines.append(f"_AVAILABLE_TOOLS: list[str] = {tool_list_literal}")
        py_lines.append(f"_AVAILABLE_TOOLS = {tool_list_literal}")
        py_lines.append("def available_tools() -> list[str]: return list(_AVAILABLE_TOOLS)")

        return "\n".join(pyi_lines) + "\n", "\n".join(py_lines) + "\n"

    def _render_tool_implementation(
        self,
        tool: ToolDefinition,
        parameter_docs: list[dict[str, Any]],
        return_type: str,
    ) -> str:
        args: list[str] = []
        call_pairs: list[str] = []
        for param in parameter_docs:
            name = str(param.get("name") or "").strip()
            python_type = str(param.get("python_type") or "Any")
            is_required = bool(param.get("required"))
            if is_required:
                args.append(f"{name}: {python_type}")
            elif "default" in param:
                default_literal = self._format_literal(param.get("default"))
                args.append(f"{name}: {python_type} = {default_literal}")
            else:
                args.append(f"{name}: {python_type} | None = None")
            call_pairs.append(f"{name}={name}")

        params = ", ".join(args)
        call_kwargs = ", ".join(call_pairs)
        
        lines = [f"def {tool.name}({params}) -> {return_type}:"]
        if call_kwargs:
            lines.append(f"    return call_tool({tool.name!r}, {call_kwargs})")
        else:
            lines.append(f"    return call_tool({tool.name!r})")
        return "\n".join(lines)

    def _safe_python_identifier(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        text = re.sub(r"\W+", "_", text)
        if not text:
            return ""
        if text[0].isdigit():
            text = f"tool_{text}"
        if keyword.iskeyword(text):
            text = f"{text}_tool"
        if not text.isidentifier():
            return ""
        return text

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
        if isinstance(normalized, bool):
            return "True" if normalized else "False"
        try:
            # Use repr for strings and numbers to be safe in Python code
            return repr(normalized)
        except Exception:
            return str(normalized)

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

        # Fallback to Skill Registry for standalone/builtin skills (e.g. from packages/)
        from app.core.database import AsyncSessionLocal
        from app.repositories.skill_registry_repository import SkillRegistryRepository
        from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor

        try:
            async with AsyncSessionLocal() as session:
                skill_repo = SkillRegistryRepository(session)
                skill = await skill_repo.get_by_tool_name(tool_name)
                if skill:
                    executor = SkillRuntimeExecutor(skill_repo)
                    inputs = dict(arguments or {})
                    inputs["__tool_name__"] = tool_name
                    
                    exec_result = await executor.execute(
                        skill_id=skill.id,
                        session_id=str(self.context.session_id or "sandbox_bridge"),
                        user_id=str(self.context.user_id),
                        inputs=inputs,
                        intent=tool_name
                    )
                    
                    if exec_result.get("status") == "ok":
                        return exec_result.get("result")
                    return {"error": exec_result.get("error", "Skill execution failed")}
        except Exception as exc:
            logger.error("Skill registry fallback failed for tool %s: %s", tool_name, exc)

        return await self._dispatch_remote_mcp_tool(tool_name, arguments, workflow_context)

    async def _dispatch_local_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        workflow_context: Any | None,
    ) -> Any | None:
        if tool_name == "sys_refine_asset_metadata":
            from app.services.providers.llm import llm_service
            prompt = arguments.get("prompt", "")
            asset_type = arguments.get("asset_type", "assistant")
            
            # Simple system prompt for refinement
            system_msg = f"You are a meta-data extractor. Extract structured {asset_type} JSON from the text. Respond ONLY with valid JSON."
            
            try:
                response = await llm_service.chat_completion(
                    messages=[
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": prompt}
                    ],
                    response_format={"type": "json_object"},
                    user_id=self.context.user_id
                )
                if isinstance(response, str):
                    return json.loads(response)
                return response
            except Exception as e:
                logger.error(f"sys_refine_asset_metadata failed: {e}")
                return {"error": str(e)}

        if tool_name == "sys_submit_onboarding_request":
            from app.services.assistant.assistant_market_service import AssistantMarketService
            from app.repositories import AssistantRepository, AssistantInstallRepository, AssistantMarketRepository
            from app.repositories.review_repository import ReviewTaskRepository
            async with self.context.get_db_session() as session:
                market_service = AssistantMarketService(
                    AssistantRepository(session),
                    AssistantInstallRepository(session),
                    ReviewTaskRepository(session),
                    AssistantMarketRepository(session)
                )
                payload = arguments.get("payload", {})
                if arguments.get("asset_type") == "assistant":
                    # For cloud, we trigger the review flow
                    await market_service.submit_for_review(
                        user_id=self.context.user_id,
                        assistant_id=uuid.UUID(payload.get("assistant_id")) if payload.get("assistant_id") else uuid.uuid4(),
                        payload=payload
                    )
                    return {"action": "pending_review", "status": "submitted"}
                return {"action": "ignored", "status": "unsupported"}

        return None

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
        return code_mode_protocol.extract_runtime_tool_request(result)

    def _extract_runtime_tool_request_from_text(
        self,
        text: str | None,
    ) -> dict[str, Any] | None:
        return code_mode_protocol.extract_runtime_tool_request_from_text(text)

    def _extract_runtime_render_blocks(self, result: dict[str, Any]) -> list[dict[str, Any]]:
        payloads = code_mode_protocol.extract_runtime_render_payloads(result)
        blocks: list[dict[str, Any]] = []
        for payload in payloads:
            normalized = self._normalize_render_block(payload)
            if normalized:
                blocks.append(normalized)
        return blocks

    def _extract_runtime_render_blocks_from_text(
        self,
        text: str | None,
    ) -> list[dict[str, Any]]:
        payloads = code_mode_protocol.extract_runtime_render_payloads_from_text(text)
        blocks: list[dict[str, Any]] = []
        for payload in payloads:
            normalized = self._normalize_render_block(payload)
            if normalized:
                blocks.append(normalized)
        return blocks

    def _normalize_render_block(self, payload: Any) -> dict[str, Any] | None:
        if not isinstance(payload, dict):
            return None

        view_type = str(payload.get("view_type") or payload.get("viewType") or "").strip()
        if not view_type:
            return None

        block: dict[str, Any] = {
            "type": "ui",
            "viewType": view_type,
            "view_type": view_type,
            "payload": self._to_jsonable(payload.get("payload") or {}),
        }
        title = payload.get("title")
        if title is not None:
            block["title"] = str(title)
        metadata = payload.get("metadata")
        if metadata is None:
            metadata = payload.get("meta")
        if metadata is not None:
            block["metadata"] = self._to_jsonable(metadata)
        return block

    async def _issue_runtime_bridge_context(
        self,
        *,
        workflow_context: Any | None,
        runtime_meta: dict[str, Any],
        final_session_id: str,
    ) -> dict[str, Any] | None:
        bridge_endpoint = str(
            getattr(settings, "CODE_MODE_BRIDGE_ENDPOINT", "") or ""
        ).strip()
        if not bridge_endpoint:
            return None

        # Resolve localhost/127.0.0.1 to host.docker.internal or a reachable IP
        if "localhost" in bridge_endpoint or "127.0.0.1" in bridge_endpoint:
            target = "host.docker.internal"
            # In some Linux environments, host.docker.internal is not defined. 
            # We can try 172.17.0.1 (default Docker bridge gateway) as a fallback.
            import socket
            try:
                socket.gethostbyname(target)
            except socket.gaierror:
                target = "172.17.0.1" # Standard Docker bridge IP
            
            bridge_endpoint = bridge_endpoint.replace("localhost", target).replace("127.0.0.1", target)

        bridge_timeout = int(
            getattr(settings, "CODE_MODE_BRIDGE_HTTP_TIMEOUT_SECONDS", 120) or 120
        )
        bridge_ttl = int(
            getattr(settings, "CODE_MODE_BRIDGE_TOKEN_TTL_SECONDS", 600) or 600
        )
        if bridge_ttl <= 0:
            bridge_ttl = 600

        raw_scopes = self._context_ns_value(workflow_context, "auth", "scopes")
        if raw_scopes is None:
            raw_scopes = self._context_ns_value(
                workflow_context, "external_auth", "scopes"
            )

        claims = RuntimeBridgeClaims(
            user_id=str(
                self._context_attr(workflow_context, "user_id", self.context.user_id)
            ),
            session_id=final_session_id,
            trace_id=self._context_attr(workflow_context, "trace_id"),
            tenant_id=self._context_attr(workflow_context, "tenant_id"),
            api_key_id=self._context_attr(workflow_context, "api_key_id"),
            capability=self._context_attr(workflow_context, "capability"),
            requested_model=self._context_attr(workflow_context, "requested_model"),
            scopes=[
                str(item)
                for item in (raw_scopes or [])
                if item is not None
            ]
            if isinstance(raw_scopes, list)
            else [],
            allowed_models=[
                str(item)
                for item in (
                    self._context_ns_value(
                        workflow_context, "external_auth", "allowed_models"
                    )
                    or []
                )
                if item is not None
            ],
            max_calls=_MAX_RUNTIME_TOOL_CALLS,
        )
        try:
            issue = await runtime_bridge_token_service.issue_token(
                claims=claims,
                ttl_seconds=max(bridge_ttl, 60),
            )
        except Exception as exc:
            logger.warning(
                "issue runtime bridge token failed execution_id=%s error=%s",
                runtime_meta.get("execution_id"),
                exc,
            )
            return None

        return {
            "endpoint": bridge_endpoint,
            "execution_token": issue.token,
            "timeout_seconds": bridge_timeout,
            "expires_at": issue.expires_at,
            "mode": "http_with_marker_fallback",
        }

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
                "trace_id": self._context_attr(
                    workflow_context, "trace_id", runtime_meta.get("trace_id")
                ),
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

    def _finalize_code_mode_response(
        self,
        payload: dict[str, Any],
        *,
        workflow_context: Any | None,
        request_started_monotonic: float,
        runtime_meta_override: dict[str, Any] | None,
        code_chars: int,
        tool_plan_steps: int,
    ) -> dict[str, Any]:
        response = dict(payload or {})
        response.setdefault("format_version", _EXECUTION_FORMAT_VERSION)
        response.setdefault("runtime_protocol_version", _RUNTIME_PROTOCOL_VERSION)

        status = str(response.get("status") or "failed").strip().lower() or "failed"
        error_code_raw = response.get("error_code")
        error_code = (
            str(error_code_raw).strip()
            if isinstance(error_code_raw, str) and error_code_raw.strip()
            else None
        )

        runtime_meta: dict[str, Any] | None = None
        if isinstance(response.get("runtime"), dict):
            runtime_meta = response.get("runtime")
        elif isinstance(runtime_meta_override, dict):
            runtime_meta = runtime_meta_override
            response["runtime"] = runtime_meta

        if runtime_meta is not None:
            self._finalize_runtime_meta(
                runtime_meta, started_monotonic=request_started_monotonic
            )
            duration_ms = int(runtime_meta.get("duration_ms") or 0)
            trace_id = (
                str(runtime_meta.get("trace_id") or "").strip()
                or str(self._context_attr(workflow_context, "trace_id", "") or "").strip()
            )
            session_id = str(runtime_meta.get("session_id") or "").strip()
            user_id = str(runtime_meta.get("user_id") or "").strip()
            execution_id = str(runtime_meta.get("execution_id") or "").strip()
            runtime_tool_calls = runtime_meta.get("runtime_tool_calls")
            runtime_tool_call_count = (
                int(runtime_tool_calls.get("count") or 0)
                if isinstance(runtime_tool_calls, dict)
                else 0
            )
        else:
            duration_ms = max(0, int((perf_counter() - request_started_monotonic) * 1000))
            trace_id = str(self._context_attr(workflow_context, "trace_id", "") or "").strip()
            session_id = str(self._context_attr(workflow_context, "session_id", "") or "").strip()
            user_id = str(self._context_attr(workflow_context, "user_id", self.context.user_id))
            execution_id = ""
            runtime_tool_call_count = 0

        try:
            record_code_mode_execution(
                status=status,
                duration_seconds=max(0.0, duration_ms / 1000.0),
                error_code=error_code,
            )
        except Exception:
            pass

        logger.info(
            "code_mode_execution",
            extra={
                "trace_id": trace_id,
                "session_id": session_id,
                "user_id": user_id,
                "execution_id": execution_id,
                "status": status,
                "error_code": error_code,
                "duration_ms": duration_ms,
                "code_chars": code_chars,
                "tool_plan_steps": tool_plan_steps,
                "runtime_tool_calls": runtime_tool_call_count,
            },
        )
        return response

    async def _persist_execution_record(
        self,
        *,
        response: dict[str, Any],
        source_code: str,
        language: str,
        tool_plan: list[dict[str, Any]],
        workflow_context: Any | None,
        code_chars: int,
        tool_plan_steps: int,
    ) -> None:
        runtime_meta = response.get("runtime")
        runtime_dict = runtime_meta if isinstance(runtime_meta, dict) else {}

        raw_user_id = runtime_dict.get("user_id") or self._context_attr(
            workflow_context, "user_id", self.context.user_id
        )
        try:
            user_id = uuid.UUID(str(raw_user_id))
        except Exception:
            return

        execution_id = str(runtime_dict.get("execution_id") or "").strip() or uuid.uuid4().hex
        session_id = str(runtime_dict.get("session_id") or "").strip() or self._resolve_session_id(
            explicit_session_id=None,
            workflow_context=workflow_context,
        )
        trace_id = str(
            runtime_dict.get("trace_id")
            or self._context_attr(workflow_context, "trace_id", "")
            or ""
        ).strip() or None

        runtime_tool_calls = runtime_dict.get("runtime_tool_calls")
        if not isinstance(runtime_tool_calls, dict):
            runtime_tool_calls = {}
        persisted_code = (
            source_code
            if len(source_code) <= _MAX_CODE_CHARS
            else source_code[:_MAX_CODE_CHARS] + "... (truncated)"
        )

        render_blocks = runtime_dict.get("render_blocks")
        if not isinstance(render_blocks, dict):
            ui = response.get("ui") if isinstance(response.get("ui"), dict) else {}
            blocks = ui.get("blocks") if isinstance(ui, dict) else []
            if isinstance(blocks, list) and blocks:
                render_blocks = {"count": len(blocks), "blocks": self._to_jsonable(blocks)}
            else:
                render_blocks = {}

        tool_plan_results: dict[str, Any] = {
            "request": self._to_jsonable(tool_plan),
            "summary": self._to_jsonable(runtime_dict.get("tool_plan")),
        }
        if isinstance(response.get("steps"), list):
            tool_plan_results["steps"] = self._to_jsonable(response.get("steps"))
        if isinstance(response.get("tool_plan"), dict):
            tool_plan_results["execution"] = self._to_jsonable(response.get("tool_plan"))

        duration_ms = int(runtime_dict.get("duration_ms") or 0)
        payload = {
            "user_id": user_id,
            "session_id": session_id,
            "execution_id": execution_id,
            "trace_id": trace_id,
            "language": str(language or "python").strip() or "python",
            "code": persisted_code,
            "status": str(response.get("status") or "failed").strip() or "failed",
            "format_version": (
                str(response.get("format_version")).strip()
                if response.get("format_version") is not None
                else None
            ),
            "runtime_protocol_version": (
                str(response.get("runtime_protocol_version")).strip()
                if response.get("runtime_protocol_version") is not None
                else None
            ),
            "runtime_context": self._to_jsonable(runtime_dict),
            "tool_plan_results": self._to_jsonable(tool_plan_results),
            "runtime_tool_calls": self._to_jsonable(runtime_tool_calls),
            "render_blocks": self._to_jsonable(render_blocks),
            "error": (
                str(response.get("error"))
                if response.get("error") is not None
                else None
            ),
            "error_code": (
                str(response.get("error_code")).strip()
                if response.get("error_code") is not None
                else None
            ),
            "duration_ms": max(0, duration_ms),
            "request_meta": {
                "code_chars": int(code_chars),
                "tool_plan_steps": int(tool_plan_steps),
            },
        }

        session_factory = getattr(self.context, "get_db_session", None)
        if not callable(session_factory):
            return

        session_or_ctx = session_factory()
        if session_or_ctx is None:
            return

        async def _write(db_session) -> None:
            if db_session is None:
                return
            repository = CodeModeExecutionRepository(db_session)
            await repository.create_execution(payload)

        try:
            if hasattr(session_or_ctx, "__aenter__") and hasattr(session_or_ctx, "__aexit__"):
                async with session_or_ctx as db_session:
                    await _write(db_session)
            else:
                await _write(session_or_ctx)
        except Exception as exc:
            logger.warning(
                "persist_code_mode_execution_failed execution_id=%s error=%s",
                execution_id,
                exc,
            )

    def _build_wrapped_code(
        self,
        user_code: str,
        *,
        tool_plan_results: dict[str, Any] | None = None,
        runtime_context: dict[str, Any] | None = None,
        runtime_tool_results: list[Any] | None = None,
        runtime_sdk_bundle: dict[str, Any] | None = None,
        lazy_context: bool = False,
        is_reexecution: bool = False,
    ) -> str:
        full_context = runtime_context or {}
        if lazy_context:
            inline_context = {"bridge": full_context.get("bridge")} if full_context.get("bridge") else {}
        else:
            inline_context = full_context

        context_json = json.dumps(inline_context, ensure_ascii=False)
        results_json = json.dumps(tool_plan_results or {}, ensure_ascii=False)
        runtime_tool_results_json = json.dumps(runtime_tool_results or [], ensure_ascii=False)

        sdk_module_name = str((runtime_sdk_bundle or {}).get("module_name") or "").strip()
        sdk_tool_count = int((runtime_sdk_bundle or {}).get("tool_count") or 0)

        # Prepare runtime paths for Official and User skills
        project_root = Path(__file__).parent.parent.parent.parent.parent
        official_skills_path = project_root / "packages" / "official-skills"
        
        # Cross-platform App Data resolution (Matches Tauri's app_data_dir)
        def get_user_skills_path():
            import platform
            home = Path.home()
            if platform.system() == "Windows":
                # Typical Windows AppData/Roaming/com.deeting.app/skills
                return home / "AppData" / "Roaming" / "com.deeting.app" / "skills"
            elif platform.system() == "Darwin":
                return home / "Library" / "Application Support" / "com.deeting.app" / "skills"
            else:
                return home / ".local" / "share" / "com.deeting.app" / "skills"

        user_skills_path = get_user_skills_path()
        
        runtime_block = (
            "import json\n"
            "import sys\n"
            "import os\n"
            "import types\n"
            "from pathlib import Path\n"
            
            # Helper to mount a directory as a module alias
            "def _mount_skill_dir(name, path):\n"
            "    p = Path(path)\n"
            "    if not p.exists(): return\n"
            "    sys.path.insert(0, str(p.parent))\n"
            "    mod = types.ModuleType(name)\n"
            "    mod.__path__ = [str(p)]\n"
            "    sys.modules[name] = mod\n"
            
            f"_mount_skill_dir('builtin_skills', {str(official_skills_path)!r})\n"
            f"_mount_skill_dir('user_skills', {str(user_skills_path)!r})\n"
            
            f"RUNTIME_CONTEXT = json.loads({context_json!r})\n"
            f"TOOL_PLAN_RESULTS = json.loads({results_json!r})\n"
            f"RUNTIME_TOOL_RESULTS = json.loads({runtime_tool_results_json!r})\n"
            "deeting = DeetingRuntime(context=RUNTIME_CONTEXT, tool_results=RUNTIME_TOOL_RESULTS)\n"
            "_deeting_module = types.ModuleType('deeting')\n"
            "for _name in ('log', 'section', 'get_context', 'render', 'call_tool', 'write_file', 'read_file'):\n"
            "    setattr(_deeting_module, _name, getattr(deeting, _name))\n"
            "setattr(_deeting_module, 'context', deeting.context)\n"
            "sys.modules['deeting'] = _deeting_module\n"
        )

        if is_reexecution and sdk_module_name:
            runtime_block += (
                "import builtins\n"
                "import os\n"
                "import sys\n"
                "builtins.__DEETING_RUNTIME__ = deeting\n"
                "_sdk_dir = '/tmp/deeting_runtime_sdk'\n"
                "if _sdk_dir not in sys.path:\n"
                "    sys.path.insert(0, _sdk_dir)\n"
            )
        elif sdk_module_name:
            sdk_pyi = str((runtime_sdk_bundle or {}).get("pyi") or "")
            sdk_py = str((runtime_sdk_bundle or {}).get("py") or "")
            sdk_pyi_json = json.dumps(sdk_pyi, ensure_ascii=False)
            sdk_py_json = json.dumps(sdk_py, ensure_ascii=False)
            runtime_block += (
                f"DEETING_SDK_MODULE = {sdk_module_name!r}\n"
                f"DEETING_SDK_PYI = json.loads({sdk_pyi_json!r})\n"
                f"DEETING_SDK_PY = json.loads({sdk_py_json!r})\n"
                "if DEETING_SDK_MODULE and (DEETING_SDK_PYI or DEETING_SDK_PY):\n"
                "    import builtins\n"
                "    import os\n"
                "    import sys\n"
                "    builtins.__DEETING_RUNTIME__ = deeting\n"
                "    _sdk_dir = '/tmp/deeting_runtime_sdk'\n"
                "    os.makedirs(_sdk_dir, exist_ok=True)\n"
                "    _sdk_py_path = os.path.join(_sdk_dir, f'{DEETING_SDK_MODULE}.py')\n"
                "    _sdk_pyi_path = os.path.join(_sdk_dir, f'{DEETING_SDK_MODULE}.pyi')\n"
                "    with open(_sdk_py_path, 'w', encoding='utf-8') as _fp:\n"
                "        _fp.write(DEETING_SDK_PY)\n"
                "    with open(_sdk_pyi_path, 'w', encoding='utf-8') as _fp:\n"
                "        _fp.write(DEETING_SDK_PYI)\n"
                "    if _sdk_dir not in sys.path:\n"
                "        sys.path.insert(0, _sdk_dir)\n"
            )

        if sdk_module_name:
            runtime_block += (
                "if isinstance(RUNTIME_CONTEXT, dict):\n"
                "    _sdk_meta = RUNTIME_CONTEXT.get('sdk')\n"
                "    if not isinstance(_sdk_meta, dict):\n"
                "        _sdk_meta = {}\n"
                f"    _sdk_meta.update({{'module': {sdk_module_name!r}, 'tool_count': {sdk_tool_count}}})\n"
                "    RUNTIME_CONTEXT['sdk'] = _sdk_meta\n"
            )

        return f"{_RUNTIME_PREAMBLE}\n{runtime_block}\n{user_code}\n"

    _ERROR_CLASSIFIERS: list[tuple[str, str, str, str]] = [
        # (error_type_prefix, regex_pattern, category, severity)
        ("SyntaxError", r"SyntaxError:\s*(.+?)(?:\s*\(.*line\s+(\d+))?", "syntax", "fixable"),
        ("IndentationError", r"IndentationError:\s*(.+)", "syntax", "fixable"),
        ("NameError", r"NameError:\s*name\s+'([^']+)'\s+is\s+not\s+defined", "reference", "fixable"),
        ("KeyError", r"KeyError:\s*['\"]?([^'\"]+)['\"]?", "key_access", "fixable"),
        ("ImportError", r"(?:ImportError|ModuleNotFoundError):\s*(.+)", "import", "fixable"),
        ("TypeError", r"TypeError:\s*(.+)", "type", "fixable"),
        ("AttributeError", r"AttributeError:\s*(.+)", "attribute", "fixable"),
        ("IndexError", r"IndexError:\s*(.+)", "index", "fixable"),
        ("ValueError", r"ValueError:\s*(.+)", "value", "fixable"),
        ("ZeroDivisionError", r"ZeroDivisionError:\s*(.+)", "arithmetic", "fixable"),
        ("RuntimeError", r"RuntimeError:\s*(.+)", "runtime", "needs_review"),
        ("TimeoutError", r"TimeoutError:\s*(.+)", "timeout", "needs_redesign"),
        ("PermissionError", r"PermissionError:\s*(.+)", "permission", "needs_review"),
        ("FileNotFoundError", r"FileNotFoundError:\s*(.+)", "file_access", "fixable"),
    ]

    def _classify_execution_error(
        self,
        stderr: str,
        stdout: str,
        exit_code: int,
    ) -> dict[str, Any] | None:
        """Parse stderr to extract structured error classification."""
        text = stderr or stdout or ""
        if not text.strip() and exit_code == 0:
            return None

        lines = text.strip().splitlines()
        traceback_lines: list[str] = []
        error_line: str = ""
        error_lineno: int | None = None

        in_traceback = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("Traceback (most recent call last)"):
                in_traceback = True
                traceback_lines = [stripped]
                continue
            if in_traceback:
                traceback_lines.append(stripped)
                lineno_match = re.search(r'line\s+(\d+)', stripped)
                if lineno_match:
                    error_lineno = int(lineno_match.group(1))

        if traceback_lines:
            error_line = traceback_lines[-1] if traceback_lines else ""
        elif lines:
            for raw_line in reversed(lines):
                stripped = raw_line.strip()
                if stripped and any(
                    stripped.startswith(prefix)
                    for prefix, *_ in self._ERROR_CLASSIFIERS
                ):
                    error_line = stripped
                    break
            if not error_line:
                error_line = lines[-1].strip()

        for type_prefix, pattern, category, severity in self._ERROR_CLASSIFIERS:
            m = re.search(pattern, text)
            if m:
                return {
                    "error_type": type_prefix,
                    "error_message": m.group(0),
                    "detail": m.group(1) if m.lastindex and m.lastindex >= 1 else "",
                    "line_number": error_lineno,
                    "category": category,
                    "severity": severity,
                    "traceback_tail": "\n".join(traceback_lines[-6:]) if traceback_lines else None,
                }

        if exit_code != 0:
            return {
                "error_type": "UnknownError",
                "error_message": error_line or f"process exited with code {exit_code}",
                "detail": "",
                "line_number": error_lineno,
                "category": "unknown",
                "severity": "needs_review",
                "traceback_tail": "\n".join(traceback_lines[-6:]) if traceback_lines else None,
            }
        return None

    def _generate_repair_hints(
        self,
        classification: dict[str, Any],
        *,
        runtime_sdk_bundle: dict[str, Any] | None = None,
    ) -> list[str]:
        """Generate context-aware repair suggestions based on error classification."""
        hints: list[str] = []
        category = classification.get("category", "")
        detail = str(classification.get("detail") or "")
        error_type = str(classification.get("error_type") or "")

        if category == "syntax":
            hints.append("Check for unmatched brackets, missing colons, or incorrect indentation.")
            if "unexpected indent" in detail.lower() or "IndentationError" in error_type:
                hints.append("Ensure consistent indentation (use 4 spaces, not tabs).")
            if "EOL" in detail or "EOF" in detail:
                hints.append("There may be an unclosed string literal or parenthesis.")

        elif category == "reference":
            name = detail
            hints.append(f"The name '{name}' is not defined in the current scope.")
            sdk_tools = self._extract_sdk_tool_names(runtime_sdk_bundle)
            if sdk_tools:
                close = [t for t in sdk_tools if name.lower() in t.lower() or t.lower() in name.lower()]
                if close:
                    hints.append(f"Did you mean one of: {', '.join(close)}?")
                module_name = str((runtime_sdk_bundle or {}).get("module_name") or "deeting_sdk")
                hints.append(f"Import SDK functions: from {module_name} import {name}")
            hints.append("Or use deeting.call_tool(tool_name, **kwargs) for dynamic calls.")

        elif category == "key_access":
            hints.append(f"Key '{detail}' was not found in the dictionary.")
            hints.append("Use .get(key, default) for safe access instead of direct indexing.")
            hints.append("Print the dict keys first to verify available fields: print(result.keys())")

        elif category == "import":
            hints.append(f"The module is not available in the sandbox environment.")
            hints.append("Only Python standard library modules are available.")
            hints.append("For external data, use deeting.call_tool() to call server-side tools.")

        elif category == "type":
            hints.append("Check the types of arguments being passed to the function.")
            if "argument" in detail.lower():
                hints.append("Verify the function signature and expected parameter types.")
            if "subscriptable" in detail.lower() or "iterable" in detail.lower():
                hints.append("The value may be None or a different type than expected. Add a type check.")

        elif category == "attribute":
            hints.append("The object does not have the expected attribute.")
            hints.append("Check the object type and its available methods/properties.")
            if "NoneType" in detail:
                hints.append("The variable is None. Add a None check before accessing attributes.")

        elif category == "index":
            hints.append("List index is out of range. Check the list length before accessing by index.")

        elif category == "file_access":
            hints.append("File not found. Check the file path and ensure the file exists.")
            hints.append("Use os.path.exists() to verify paths before access.")

        elif category == "timeout":
            hints.append("Execution timed out. Reduce data size or optimize the algorithm.")
            hints.append("Break long operations into smaller batches.")

        elif category == "permission":
            hints.append("Permission denied. The sandbox restricts certain system operations.")

        if not hints:
            hints.append("Review the error traceback above for the root cause.")
            hints.append("Simplify the code to isolate the issue.")

        return hints

    def _extract_sdk_tool_names(self, runtime_sdk_bundle: dict[str, Any] | None) -> list[str]:
        """Extract available tool names from SDK bundle for error hints."""
        if not runtime_sdk_bundle:
            return []
        py_content = str(runtime_sdk_bundle.get("py") or "")
        names: list[str] = []
        for line in py_content.splitlines():
            m = re.match(r"def\s+(\w+)\s*\(", line)
            if m:
                fn = m.group(1)
                if fn not in {"_runtime", "call_tool", "available_tools"}:
                    names.append(fn)
        return names

    def _format_execution_result(
        self,
        result: dict[str, Any],
        session_id: str,
        runtime_meta: dict[str, Any],
        *,
        started_monotonic: float | None = None,
        render_blocks: list[dict[str, Any]] | None = None,
        runtime_sdk_bundle: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._finalize_runtime_meta(runtime_meta, started_monotonic=started_monotonic)
        if "error" in result:
            err_response: dict[str, Any] = {
                "status": "failed",
                "format_version": _EXECUTION_FORMAT_VERSION,
                "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
                "session_id": session_id,
                "runtime": runtime_meta,
                "error": result.get("error"),
                "error_code": result.get("error_code"),
                "error_detail": result.get("error_detail"),
            }
            err_text = str(result.get("error") or "") + "\n" + str(result.get("error_detail") or "")
            classification = self._classify_execution_error(err_text, "", 1)
            if classification:
                classification["repair_hints"] = self._generate_repair_hints(
                    classification, runtime_sdk_bundle=runtime_sdk_bundle,
                )
                err_response["error_analysis"] = classification
            return err_response

        stdout = self._strip_runtime_signal_lines(self._join_chunks(result.get("stdout")))
        stderr = self._strip_runtime_signal_lines(self._join_chunks(result.get("stderr")))
        final_result = self._strip_runtime_signal_lines(
            self._join_chunks(result.get("result"))
        )
        exit_code = int(result.get("exit_code", 0) or 0)

        stdout_trimmed, stdout_truncated = self._truncate(stdout)
        stderr_trimmed, stderr_truncated = self._truncate(stderr)
        final_result_trimmed, result_truncated = self._truncate(final_result)
        if exit_code == 0 and not final_result_trimmed.strip():
            recovered_result = self._recover_structured_result_from_stdout(stdout_trimmed)
            if recovered_result:
                recovered_result_trimmed, recovered_result_truncated = self._truncate(
                    recovered_result
                )
                final_result_trimmed = recovered_result_trimmed
                result_truncated = result_truncated or recovered_result_truncated
                result_preview, result_preview_truncated = self._truncate_for_log(
                    recovered_result_trimmed, limit=_MAX_LOG_IO_PREVIEW_CHARS
                )
                logger.info(
                    "code_mode_result_recovered",
                    extra={
                        "execution_id": str(runtime_meta.get("execution_id") or "").strip(),
                        "trace_id": str(runtime_meta.get("trace_id") or "").strip(),
                        "session_id": str(runtime_meta.get("session_id") or session_id).strip(),
                        "stdout_chars": len(stdout_trimmed),
                        "recovered_result_chars": len(recovered_result_trimmed),
                        "result_preview": result_preview,
                        "result_preview_truncated": result_preview_truncated,
                        "source": "stdout_last_structured_line",
                    },
                )
            else:
                stdout_preview, stdout_preview_truncated = self._truncate_for_log(
                    stdout_trimmed, limit=_MAX_LOG_IO_PREVIEW_CHARS
                )
                stderr_preview, stderr_preview_truncated = self._truncate_for_log(
                    stderr_trimmed, limit=_MAX_LOG_IO_PREVIEW_CHARS
                )
                logger.info(
                    "code_mode_empty_result",
                    extra={
                        "execution_id": str(runtime_meta.get("execution_id") or "").strip(),
                        "trace_id": str(runtime_meta.get("trace_id") or "").strip(),
                        "session_id": str(runtime_meta.get("session_id") or session_id).strip(),
                        "stdout_chars": len(stdout_trimmed),
                        "stderr_chars": len(stderr_trimmed),
                        "result_chars": len(final_result_trimmed),
                        "stdout_preview": stdout_preview,
                        "stderr_preview": stderr_preview,
                        "stdout_preview_truncated": stdout_preview_truncated,
                        "stderr_preview_truncated": stderr_preview_truncated,
                    },
                )

        response = {
            "status": "success" if exit_code == 0 else "failed",
            "format_version": _EXECUTION_FORMAT_VERSION,
            "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
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
        if render_blocks:
            response["ui"] = {"blocks": render_blocks}
        if exit_code != 0:
            classification = self._classify_execution_error(
                stderr_trimmed, stdout_trimmed, exit_code,
            )
            if classification:
                classification["repair_hints"] = self._generate_repair_hints(
                    classification, runtime_sdk_bundle=runtime_sdk_bundle,
                )
                response["error_analysis"] = classification
        return response

    def _build_runtime_meta(
        self,
        source: str,
        session_id: str,
        *,
        workflow_context: Any | None = None,
    ) -> dict[str, Any]:
        started_at = datetime.now(UTC).isoformat()
        return {
            "execution_id": uuid.uuid4().hex,
            "session_id": session_id,
            "user_id": self._resolve_runtime_user_id(workflow_context),
            "runtime_protocol_version": _RUNTIME_PROTOCOL_VERSION,
            "started_at": started_at,
            "code_sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
            "submitted_at": started_at,
        }

    def _resolve_runtime_user_id(self, workflow_context: Any | None) -> str:
        raw_user_id = self._context_attr(workflow_context, "user_id", self.context.user_id)
        if raw_user_id is None:
            return str(self.context.user_id)
        return str(raw_user_id)

    def _finalize_runtime_meta(
        self,
        runtime_meta: dict[str, Any],
        *,
        started_monotonic: float | None,
    ) -> None:
        if not isinstance(runtime_meta, dict):
            return
        runtime_meta["runtime_protocol_version"] = _RUNTIME_PROTOCOL_VERSION
        if runtime_meta.get("duration_ms") is None and started_monotonic is not None:
            runtime_meta["duration_ms"] = max(
                0, int((perf_counter() - started_monotonic) * 1000)
            )

    def _join_chunks(self, value: Any) -> str:
        return code_mode_protocol.join_chunks(value)

    def _strip_runtime_signal_lines(self, text: str) -> str:
        return code_mode_protocol.strip_runtime_signal_lines(text)

    def _truncate(self, text: str) -> tuple[str, bool]:
        if len(text) <= _MAX_RESULT_CHARS:
            return text, False
        return text[:_MAX_RESULT_CHARS] + "... (truncated)", True

    def _truncate_for_log(self, text: str, *, limit: int) -> tuple[str, bool]:
        if limit <= 0:
            return "", bool(text)
        if len(text) <= limit:
            return text, False
        return text[:limit] + "... (truncated)", True

    def _recover_structured_result_from_stdout(self, stdout: str) -> str:
        if not stdout:
            return ""

        for raw_line in reversed(stdout.splitlines()):
            line = str(raw_line or "").strip()
            if not line:
                continue

            candidates: list[str] = [line]
            if line.startswith("[deeting.log]"):
                log_payload = line[len("[deeting.log]") :].strip()
                if log_payload:
                    candidates.insert(0, log_payload)

            for candidate in candidates:
                parsed = self._parse_structured_result_candidate(candidate)
                if parsed is None:
                    continue
                return json.dumps(self._to_jsonable(parsed), ensure_ascii=False)
        return ""

    def _parse_structured_result_candidate(self, text: str) -> Any | None:
        raw = str(text or "").strip()
        if not raw:
            return None

        try:
            parsed = json.loads(raw)
            if isinstance(parsed, (dict, list)):
                return parsed
        except Exception:
            pass

        try:
            parsed = ast.literal_eval(raw)
        except Exception:
            return None
        if isinstance(parsed, (dict, list, tuple)):
            return parsed
        return None
