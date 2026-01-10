"""
内部 Bridge / MCP 路由（仅内部网关使用）。

能力：
- 列出云端 Tunnel Gateway 的 Agents / Tools
- 签发 Bridge Agent token（单活版本）
- 透传 invoke/cancel
- SSE 事件流透传
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import logger
from app.deps.auth import get_current_user
from app.services.mcp_bridge.bridge_agent_token import (
    BridgeAgentTokenService,
    generate_agent_id,
    normalize_agent_id,
    validate_agent_id,
)
from app.services.mcp_bridge.bridge_gateway_client import BridgeGatewayClient

router = APIRouter(prefix="/bridge", tags=["Bridge"])


def _service_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail={"code": "bridge_gateway_unavailable", "message": str(exc)})


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
        logger.warning("bridge.list_tools_failed", extra={"agent_id": agent_id, "error": str(exc)})
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
        raise HTTPException(status_code=400, detail={"code": "invalid_agent_id", "message": str(exc)})

    reset = bool(payload.get("reset", False))
    service = BridgeAgentTokenService(session=db)
    result = await service.issue_token(user_id=uuid.UUID(str(user.id)), agent_id=agent_id, reset=reset)

    return {
        "agent_id": agent_id,
        "token": result.token,
        "expires_at": result.expires_at.isoformat(),
        "version": result.version,
        "reset": reset,
    }


@router.post("/invoke")
async def invoke_tool(payload: dict[str, Any]) -> dict[str, Any]:
    client = BridgeGatewayClient()
    req_id = str(payload.get("req_id") or "").strip() or uuid.uuid4().hex
    agent_id = str(payload.get("agent_id") or "").strip()
    tool_name = str(payload.get("tool_name") or "").strip()
    arguments = payload.get("arguments") if isinstance(payload.get("arguments"), dict) else {}
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
        logger.warning("bridge.invoke_failed", extra={"agent_id": agent_id, "tool": tool_name, "error": str(exc)})
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
        logger.warning("bridge.cancel_failed", extra={"agent_id": agent_id, "req_id": req_id, "error": str(exc)})
        raise _service_unavailable(exc)


@router.get("/events")
async def bridge_events() -> StreamingResponse:
    client = BridgeGatewayClient()

    async def gen():
        async for chunk in client.stream_events():
            yield chunk

    return StreamingResponse(gen(), media_type="text/event-stream")
