from __future__ import annotations

import json
import logging
import uuid
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.schemas.spec_agent_api import (
    SpecDraftRequest,
    SpecDraftResponse,
    SpecPlanDetailResponse,
    SpecPlanInteractRequest,
    SpecPlanInteractResponse,
    SpecPlanListItem,
    SpecPlanNodeUpdateRequest,
    SpecPlanNodeUpdateResponse,
    SpecPlanStartResponse,
    SpecPlanStatusResponse,
)
from app.services.agent import spec_agent_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/spec-agent", tags=["SpecAgent"])


def _format_sse_event(event: str, data: dict[str, Any] | str) -> bytes:
    if isinstance(data, str):
        payload = data
    else:
        payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


@router.post("/draft", response_model=SpecDraftResponse)
async def draft_spec_plan(
    payload: SpecDraftRequest,
    stream: bool = Query(True, description="是否使用 SSE 流式返回节点"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not stream:
        try:
            plan, manifest = await spec_agent_service.generate_plan(
                db, user.id, payload.query, payload.context, payload.model
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("spec_agent_draft_failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail="spec_agent_draft_failed"
            ) from exc
        return SpecDraftResponse(plan_id=plan.id, manifest=manifest)

    async def gen() -> AsyncGenerator[bytes, None]:
        yield _format_sse_event("drafting", {"status": "thinking"})
        try:
            plan, manifest = await spec_agent_service.generate_plan(
                db, user.id, payload.query, payload.context, payload.model
            )
            yield _format_sse_event(
                "plan_init",
                {
                    "plan_id": str(plan.id),
                    "project_name": manifest.project_name,
                    "conversation_session_id": str(plan.conversation_session_id)
                    if plan.conversation_session_id
                    else None,
                },
            )
            for node in manifest.nodes:
                yield _format_sse_event(
                    "node_added", {"node": node.model_dump(mode="json")}
                )
                for dep in node.needs:
                    yield _format_sse_event(
                        "link_added", {"source": dep, "target": node.id}
                    )
            yield _format_sse_event("plan_ready", {"plan_id": str(plan.id)})
        except Exception as exc:  # noqa: BLE001
            logger.exception("spec_agent_draft_stream_failed")
            yield _format_sse_event("plan_error", {"message": "spec_agent_draft_failed"})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/plans/{plan_id}", response_model=SpecPlanDetailResponse)
async def get_spec_plan(
    plan_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        detail = await spec_agent_service.get_plan_detail(db, user.id, plan_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return detail


@router.get("/plans", response_model=CursorPage[SpecPlanListItem])
async def list_spec_plans(
    params: CursorParams = Depends(),
    status_filter: str | None = Query(None, alias="status", description="按状态过滤"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await spec_agent_service.list_plans(
        db, user.id, params=params, status=status_filter
    )


@router.get("/plans/{plan_id}/status", response_model=SpecPlanStatusResponse)
async def get_spec_plan_status(
    plan_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        status_payload = await spec_agent_service.get_plan_status(db, user.id, plan_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return status_payload


@router.post("/plans/{plan_id}/start", response_model=SpecPlanStartResponse)
async def start_spec_plan(
    plan_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await spec_agent_service.start_plan(db, user.id, plan_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return SpecPlanStartResponse(**result)


@router.post("/plans/{plan_id}/interact", response_model=SpecPlanInteractResponse)
async def interact_spec_plan(
    plan_id: uuid.UUID,
    payload: SpecPlanInteractRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await spec_agent_service.interact_with_plan(
            db, user.id, plan_id, payload.node_id, payload.decision, payload.feedback
        )
    except ValueError as exc:
        detail = str(exc)
        if detail == "plan_not_found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc
    return SpecPlanInteractResponse(
        plan_id=plan_id, node_id=payload.node_id, decision=payload.decision
    )


@router.patch(
    "/plans/{plan_id}/nodes/{node_id}", response_model=SpecPlanNodeUpdateResponse
)
async def update_spec_plan_node(
    plan_id: uuid.UUID,
    node_id: str,
    payload: SpecPlanNodeUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await spec_agent_service.update_plan_node_model(
            db, user.id, plan_id, node_id, payload.model_override
        )
    except ValueError as exc:
        detail = str(exc)
        if detail in ("plan_not_found", "node_not_found"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc
    return SpecPlanNodeUpdateResponse(**result)
