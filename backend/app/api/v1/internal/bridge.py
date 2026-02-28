"""
内部 Bridge / MCP 路由（仅内部网关使用）。

能力：
- 列出云端 Tunnel Gateway 的 Agents / Tools
- 签发 Bridge Agent token（单活版本）
- 透传 invoke/cancel
- SSE 事件流透传
- 文件引用（File Bindings）读写
"""

from __future__ import annotations

import base64
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent_plugins.builtins.deeting_core_sdk.plugin import DeetingCoreSdkPlugin
from app.agent_plugins.core.context import ConcretePluginContext
from app.core.config import settings
from app.core.database import get_db
from app.core.logging import logger
from app.core.metrics import RequestTimer, record_code_mode_bridge_call
from app.deps.auth import get_current_user
from app.services.code_mode.audit_service import code_mode_audit_service
from app.services.code_mode.runtime_bridge_token_service import (
    RuntimeBridgeClaims,
    runtime_bridge_token_service,
)
from app.services.mcp_bridge.bridge_agent_token import (
    BridgeAgentTokenService,
    generate_agent_id,
    normalize_agent_id,
    validate_agent_id,
)
from app.services.mcp_bridge.bridge_gateway_client import BridgeGatewayClient
from app.services.orchestrator.context import Channel, WorkflowContext

router = APIRouter(prefix="/bridge", tags=["Bridge"])


def _service_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "bridge_gateway_unavailable", "message": str(exc)},
    )


class CodeModeBridgeCallRequest(BaseModel):
    tool_name: str = Field(..., description="工具名称")
    arguments: dict[str, Any] = Field(default_factory=dict, description="工具参数")
    execution_token: str | None = Field(
        default=None, description="运行时执行令牌（可通过 Header 传入）"
    )


def _parse_csv(raw: str | None) -> set[str]:
    text = str(raw or "").strip()
    if not text:
        return set()
    return {item.strip() for item in text.split(",") if item.strip()}


def _extract_scope_values(
    scopes: list[str] | None,
    scope_type: str,
) -> set[str]:
    values: set[str] = set()
    for raw in scopes or []:
        item = str(raw or "").strip()
        if ":" not in item:
            continue
        tp, val = item.split(":", 1)
        if tp.strip() == scope_type and val.strip():
            values.add(val.strip())
    return values


def _resolve_token(
    payload: CodeModeBridgeCallRequest,
    header_token: str | None,
) -> str:
    from_header = str(header_token or "").strip()
    if from_header:
        return from_header
    return str(payload.execution_token or "").strip()


def _enforce_trusted_ip_if_needed(request: Request) -> None:
    if not bool(getattr(settings, "CODE_MODE_BRIDGE_ENFORCE_TRUSTED_IPS", False)):
        return

    trusted_ips = _parse_csv(getattr(settings, "CODE_MODE_BRIDGE_TRUSTED_IPS", ""))
    client_ip = request.client.host if request and request.client else ""

    if not trusted_ips:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "CODE_MODE_BRIDGE_IP_FORBIDDEN",
                "message": "trusted ip allowlist is empty while enforcement is enabled",
            },
        )
    if client_ip not in trusted_ips:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "CODE_MODE_BRIDGE_IP_FORBIDDEN",
                "message": f"client ip '{client_ip}' is not allowed",
            },
        )


def _enforce_claim_permissions(claims: RuntimeBridgeClaims, tool_name: str) -> None:
    requested_model = str(claims.requested_model or "").strip()
    capability = str(claims.capability or "").strip()
    allowed_models = {str(item).strip() for item in (claims.allowed_models or []) if str(item).strip()}
    model_scopes = _extract_scope_values(claims.scopes, "model")
    capability_scopes = _extract_scope_values(claims.scopes, "capability")

    if allowed_models:
        if not requested_model or requested_model not in allowed_models:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "CODE_MODE_BRIDGE_SCOPE_DENIED",
                    "message": (
                        f"requested model '{requested_model or '<empty>'}' is not allowed "
                        "for runtime bridge call"
                    ),
                },
            )

    if model_scopes:
        if not requested_model or requested_model not in model_scopes:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "CODE_MODE_BRIDGE_SCOPE_DENIED",
                    "message": (
                        f"requested model '{requested_model or '<empty>'}' is outside model scopes"
                    ),
                },
            )

    if capability_scopes:
        if not capability or capability not in capability_scopes:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "CODE_MODE_BRIDGE_SCOPE_DENIED",
                    "message": (
                        f"capability '{capability or '<empty>'}' is outside capability scopes"
                    ),
                },
            )

    logger.debug(
        "code_mode_bridge_scope_ok",
        extra={
            "tool_name": tool_name,
            "requested_model": requested_model,
            "capability": capability,
            "scope_count": len(claims.scopes or []),
        },
    )


def _detail_code(detail: Any, fallback: str) -> str:
    if isinstance(detail, dict):
        code = detail.get("code")
        if code:
            return str(code)
    return fallback


async def _dispatch_code_mode_tool(
    *,
    claims: RuntimeBridgeClaims,
    tool_name: str,
    arguments: dict[str, Any],
) -> Any:
    try:
        user_id = uuid.UUID(str(claims.user_id))
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "CODE_MODE_BRIDGE_INVALID_TOKEN",
                "message": f"invalid user_id in execution token: {exc}",
            },
        )

    plugin = DeetingCoreSdkPlugin()
    plugin._context = ConcretePluginContext(
        plugin_name=plugin.metadata.name,
        plugin_id=plugin.metadata.name,
        user_id=user_id,
        session_id=claims.session_id,
    )

    # 核心修复：尝试从全局活跃表中找回原始的 WorkflowContext 以恢复推送能力
    active_ctx = WorkflowContext.get_active(claims.trace_id) if claims.trace_id else None
    
    if active_ctx:
        workflow_context = active_ctx
        logger.debug("CodeModeBridge: found and reused active workflow context for trace_id=%s", claims.trace_id)
    else:
        workflow_context = WorkflowContext(
            channel=Channel.INTERNAL,
            user_id=str(claims.user_id),
            tenant_id=claims.tenant_id,
            api_key_id=claims.api_key_id,
            session_id=claims.session_id,
            trace_id=claims.trace_id,
            capability=claims.capability,
            requested_model=claims.requested_model,
        )
        if claims.scopes:
            workflow_context.set("auth", "scopes", claims.scopes)
        if claims.allowed_models:
            workflow_context.set("external_auth", "allowed_models", claims.allowed_models)

    result = await plugin._dispatch_real_tool(
        tool_name=tool_name,
        arguments=arguments,
        workflow_context=workflow_context,
    )
    return plugin._to_jsonable(result)


@router.get("/agents")
async def list_agents() -> dict[str, Any]:
    client = BridgeGatewayClient()
    try:
        return await client.list_agents()
    except Exception as exc:
        logger.warning("bridge.list_agents_failed", extra={"error": str(exc)})
        raise _service_unavailable(exc)


@router.get("/agents/{agent_id}/tools")
async def list_agent_tools(agent_id: str) -> dict[str, Any]:
    client = BridgeGatewayClient()
    try:
        return await client.list_tools(agent_id)
    except Exception as exc:
        logger.warning(
            "bridge.list_tools_failed", extra={"agent_id": agent_id, "error": str(exc)}
        )
        raise _service_unavailable(exc)


@router.post("/agent-token")
async def issue_agent_token(
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> dict[str, Any]:
    requested = payload.get("agent_id")
    agent_id = normalize_agent_id(str(requested) if requested is not None else None)
    if not agent_id:
        agent_id = generate_agent_id()
    try:
        validate_agent_id(agent_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail={"code": "invalid_agent_id", "message": str(exc)}
        )

    reset = bool(payload.get("reset", False))
    service = BridgeAgentTokenService(session=db)
    result = await service.issue_token(
        user_id=uuid.UUID(str(user.id)), agent_id=agent_id, reset=reset
    )

    return {
        "agent_id": agent_id,
        "token": result.token,
        "expires_at": result.expires_at.isoformat(),
        "version": result.version,
        "reset": reset,
    }


@router.get("/agent-tokens")
async def list_agent_tokens(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> list[dict[str, Any]]:
    service = BridgeAgentTokenService(session=db)
    tokens = await service.list_tokens(user_id=uuid.UUID(str(user.id)))
    return [
        {
            "agent_id": t.agent_id,
            "version": t.version,
            "issued_at": t.issued_at.isoformat(),
            "expires_at": t.expires_at.isoformat(),
        }
        for t in tokens
    ]


@router.delete("/agent-tokens/{agent_id}")
async def revoke_agent_token(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> dict[str, Any]:
    service = BridgeAgentTokenService(session=db)
    success = await service.revoke_token(
        user_id=uuid.UUID(str(user.id)), agent_id=agent_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Agent token not found")
    return {"message": "Agent token revoked"}


class CodeModeBridgeContextRequest(BaseModel):
    execution_token: str | None = Field(
        default=None, description="运行时执行令牌（可通过 Header 传入）"
    )


@router.post("/context")
async def code_mode_get_context(
    payload: CodeModeBridgeContextRequest,
    request: Request,
    x_code_mode_execution_token: str | None = Header(
        default=None, alias="X-Code-Mode-Execution-Token"
    ),
) -> dict[str, Any]:
    """Lazy context retrieval endpoint for sandbox runtime."""
    _enforce_trusted_ip_if_needed(request)

    from_header = str(x_code_mode_execution_token or "").strip()
    token = from_header if from_header else str(payload.execution_token or "").strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"code": "CODE_MODE_BRIDGE_MISSING_TOKEN", "message": "missing execution token"},
        )

    consumed = await runtime_bridge_token_service.consume_call(token)
    if not consumed.get("ok"):
        error_code = str(consumed.get("error_code") or "CODE_MODE_BRIDGE_INVALID_TOKEN")
        raise HTTPException(
            status_code=401,
            detail={"code": error_code, "message": str(consumed.get("error") or "auth failed")},
        )

    context = await runtime_bridge_token_service.retrieve_context(token)
    if context is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "CODE_MODE_BRIDGE_CONTEXT_NOT_FOUND", "message": "no context stored for token"},
        )

    return {"ok": True, "context": context}


# --- File Bindings ---
# In-memory file store keyed by ref_id. TTL handled by bridge token expiry.
_file_store: dict[str, dict[str, Any]] = {}
_MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


class CodeModeBridgeFileWriteRequest(BaseModel):
    name: str = Field(..., description="File name")
    content_base64: str = Field(..., description="Base64-encoded file content")
    content_type: str = Field(default="application/octet-stream", description="MIME type")
    execution_token: str | None = Field(default=None, description="运行时执行令牌")


class CodeModeBridgeFileReadRequest(BaseModel):
    ref_id: str = Field(..., description="File reference ID")
    execution_token: str | None = Field(default=None, description="运行时执行令牌")


@router.post("/file/write")
async def code_mode_file_write(
    payload: CodeModeBridgeFileWriteRequest,
    request: Request,
    x_code_mode_execution_token: str | None = Header(
        default=None, alias="X-Code-Mode-Execution-Token"
    ),
) -> dict[str, Any]:
    """Store file data and return a lightweight file reference."""
    from app.services.code_mode.protocol import make_file_ref

    _enforce_trusted_ip_if_needed(request)

    from_header = str(x_code_mode_execution_token or "").strip()
    token = from_header if from_header else str(payload.execution_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail={"code": "CODE_MODE_BRIDGE_MISSING_TOKEN"})

    consumed = await runtime_bridge_token_service.consume_call(token)
    if not consumed.get("ok"):
        raise HTTPException(status_code=401, detail={"code": consumed.get("error_code")})

    try:
        raw_data = base64.b64decode(payload.content_base64)
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "INVALID_BASE64"})

    if len(raw_data) > _MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail={"code": "FILE_TOO_LARGE", "max_bytes": _MAX_FILE_SIZE})

    ref = make_file_ref(
        name=payload.name,
        content_type=payload.content_type,
        size=len(raw_data),
    )
    ref_id = ref["id"]
    _file_store[ref_id] = {"data": raw_data, "meta": ref}
    return {"ok": True, "file_ref": ref}


@router.post("/file/read")
async def code_mode_file_read(
    payload: CodeModeBridgeFileReadRequest,
    request: Request,
    x_code_mode_execution_token: str | None = Header(
        default=None, alias="X-Code-Mode-Execution-Token"
    ),
) -> dict[str, Any]:
    """Retrieve file data by file reference ID."""
    _enforce_trusted_ip_if_needed(request)

    from_header = str(x_code_mode_execution_token or "").strip()
    token = from_header if from_header else str(payload.execution_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail={"code": "CODE_MODE_BRIDGE_MISSING_TOKEN"})

    consumed = await runtime_bridge_token_service.consume_call(token)
    if not consumed.get("ok"):
        raise HTTPException(status_code=401, detail={"code": consumed.get("error_code")})

    entry = _file_store.get(payload.ref_id)
    if not entry:
        raise HTTPException(status_code=404, detail={"code": "FILE_NOT_FOUND"})

    return {
        "ok": True,
        "file_ref": entry["meta"],
        "content_base64": base64.b64encode(entry["data"]).decode("ascii"),
    }


@router.post("/call")
async def code_mode_call_tool(
    payload: CodeModeBridgeCallRequest,
    request: Request,
    x_code_mode_execution_token: str | None = Header(
        default=None, alias="X-Code-Mode-Execution-Token"
    ),
) -> dict[str, Any]:
    timer = RequestTimer()
    tool_name = str(payload.tool_name or "").strip()
    arguments = payload.arguments if isinstance(payload.arguments, dict) else {}
    client_ip = request.client.host if request and request.client else ""
    claims: RuntimeBridgeClaims | None = None
    call_index: int | None = None
    max_calls: int | None = None
    audit_fields = {
        "tool_name": tool_name,
        "client_ip": client_ip,
    }

    try:
        _enforce_trusted_ip_if_needed(request)

        token = _resolve_token(payload, x_code_mode_execution_token)
        consumed = await runtime_bridge_token_service.consume_call(token)
        if not consumed.get("ok"):
            error_code = str(consumed.get("error_code") or "CODE_MODE_BRIDGE_INVALID_TOKEN")
            status_code = 429 if error_code == "CODE_MODE_BRIDGE_CALL_LIMIT" else 401
            raise HTTPException(
                status_code=status_code,
                detail={
                    "code": error_code,
                    "message": str(consumed.get("error") or "bridge auth failed"),
                },
            )

        if not tool_name:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "CODE_MODE_BRIDGE_MISSING_TOOL_NAME",
                    "message": "tool_name is required",
                },
            )
        if tool_name in {"search_sdk", "execute_code_plan"}:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "CODE_MODE_BRIDGE_TOOL_NOT_ALLOWED",
                    "message": f"tool_name '{tool_name}' is not allowed",
                },
            )

        claims = consumed["claims"]
        call_index = int(consumed.get("call_index") or 0)
        max_calls = int(consumed.get("max_calls") or 0)
        _enforce_claim_permissions(claims, tool_name)

        result = await _dispatch_code_mode_tool(
            claims=claims,
            tool_name=tool_name,
            arguments=arguments,
        )
        success = not (isinstance(result, dict) and bool(result.get("error")))
        error_code = (
            str(result.get("error_code") or "tool_error")
            if isinstance(result, dict) and result.get("error")
            else None
        )
        duration_seconds = timer.seconds()
        record_code_mode_bridge_call(
            tool_name=tool_name,
            success=success,
            duration_seconds=duration_seconds,
            error_code=error_code,
        )
        logger.info(
            "code_mode_bridge_call",
            extra={
                **audit_fields,
                "status": "success" if success else "tool_error",
                "duration_ms": round(duration_seconds * 1000, 2),
                "trace_id": claims.trace_id,
                "session_id": claims.session_id,
                "call_index": call_index,
                "max_calls": max_calls,
                "error_code": error_code,
            },
        )
        code_mode_audit_service.record_bridge_call(
            tool_name=tool_name,
            arguments=arguments,
            status="success" if success else "tool_error",
            duration_ms=duration_seconds * 1000,
            trace_id=claims.trace_id,
            session_id=claims.session_id,
            user_id=claims.user_id,
            call_index=call_index,
            max_calls=max_calls,
            error_code=error_code,
            client_ip=client_ip,
        )

        return {
            "ok": success,
            "result": result,
            "meta": {
                "call_index": call_index,
                "max_calls": max_calls,
                "trace_id": claims.trace_id,
                "session_id": claims.session_id,
            },
        }
    except HTTPException as exc:
        error_code = _detail_code(exc.detail, "CODE_MODE_BRIDGE_HTTP_EXCEPTION")
        duration_seconds = timer.seconds()
        record_code_mode_bridge_call(
            tool_name=tool_name,
            success=False,
            duration_seconds=duration_seconds,
            error_code=error_code,
        )
        logger.warning(
            "code_mode_bridge_call_rejected",
            extra={
                **audit_fields,
                "status": "rejected",
                "duration_ms": round(duration_seconds * 1000, 2),
                "http_status": exc.status_code,
                "error_code": error_code,
            },
        )
        code_mode_audit_service.record_bridge_call(
            tool_name=tool_name,
            arguments=arguments,
            status="rejected",
            duration_ms=duration_seconds * 1000,
            trace_id=claims.trace_id if claims else None,
            session_id=claims.session_id if claims else None,
            user_id=claims.user_id if claims else None,
            call_index=call_index,
            max_calls=max_calls,
            error_code=error_code,
            http_status=exc.status_code,
            error=str(exc.detail),
            client_ip=client_ip,
        )
        raise
    except Exception as exc:
        duration_seconds = timer.seconds()
        record_code_mode_bridge_call(
            tool_name=tool_name,
            success=False,
            duration_seconds=duration_seconds,
            error_code="CODE_MODE_BRIDGE_DISPATCH_FAILED",
        )
        logger.exception(
            "code_mode_bridge_call_failed",
            extra={
                **audit_fields,
                "status": "failed",
                "duration_ms": round(duration_seconds * 1000, 2),
                "error": str(exc),
            },
        )
        code_mode_audit_service.record_bridge_call(
            tool_name=tool_name,
            arguments=arguments,
            status="failed",
            duration_ms=duration_seconds * 1000,
            trace_id=claims.trace_id if claims else None,
            session_id=claims.session_id if claims else None,
            user_id=claims.user_id if claims else None,
            call_index=call_index,
            max_calls=max_calls,
            error_code="CODE_MODE_BRIDGE_DISPATCH_FAILED",
            http_status=500,
            error=str(exc),
            client_ip=client_ip,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "code": "CODE_MODE_BRIDGE_DISPATCH_FAILED",
                "message": "bridge dispatch failed",
            },
        ) from exc


@router.post("/invoke")
async def invoke_tool(payload: dict[str, Any]) -> dict[str, Any]:
    client = BridgeGatewayClient()
    req_id = str(payload.get("req_id") or "").strip() or uuid.uuid4().hex
    agent_id = str(payload.get("agent_id") or "").strip()
    tool_name = str(payload.get("tool_name") or "").strip()
    arguments = (
        payload.get("arguments") if isinstance(payload.get("arguments"), dict) else {}
    )
    timeout_ms = int(payload.get("timeout_ms") or 60000)
    stream = bool(payload.get("stream", True))

    if not agent_id:
        raise HTTPException(status_code=400, detail={"code": "missing_agent_id"})
    if not tool_name:
        raise HTTPException(status_code=400, detail={"code": "missing_tool_name"})

    try:
        return await client.invoke(
            req_id=req_id,
            agent_id=agent_id,
            tool_name=tool_name,
            arguments=arguments,
            timeout_ms=timeout_ms,
            stream=stream,
        )
    except Exception as exc:
        logger.warning(
            "bridge.invoke_failed",
            extra={"agent_id": agent_id, "tool": tool_name, "error": str(exc)},
        )
        raise _service_unavailable(exc)


@router.post("/cancel")
async def cancel_tool(payload: dict[str, Any]) -> dict[str, Any]:
    client = BridgeGatewayClient()
    req_id = str(payload.get("req_id") or "").strip()
    agent_id = str(payload.get("agent_id") or "").strip()
    reason = str(payload.get("reason") or "user_cancel").strip()
    if not req_id or not agent_id:
        raise HTTPException(status_code=400, detail={"code": "missing_req_or_agent"})
    try:
        return await client.cancel(req_id=req_id, agent_id=agent_id, reason=reason)
    except Exception as exc:
        logger.warning(
            "bridge.cancel_failed",
            extra={"agent_id": agent_id, "req_id": req_id, "error": str(exc)},
        )
        raise _service_unavailable(exc)


@router.get("/events")
async def bridge_events() -> StreamingResponse:
    client = BridgeGatewayClient()

    async def gen():
        async for chunk in client.stream_events():
            yield chunk

    return StreamingResponse(gen(), media_type="text/event-stream")
