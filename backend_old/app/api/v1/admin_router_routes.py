from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.deps import get_db
from app.jwt_auth import AuthenticatedUser, require_superuser
from app.models.agent_task import AgentTaskStatus, AgentTaskType
from app.repositories import agent_task_repository
from app.tasks.agent_tasks import agent_rule_gen_task

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/v1/admin/router",
    tags=["admin-router"],
    dependencies=[Depends(require_superuser)],
)


class RouterCommand(BaseModel):
    """
    轻量 Router 输入：
    - intent=create_task + task_type=preset_capability_fill 时，会创建/触发 Celery 任务。
    - intent=chat 目前直接回显（占位）。
    """

    intent: str = Field(..., description="chat | create_task")
    task_type: str | None = Field(
        default=None,
        description="当 intent=create_task 时必填，例如 preset_capability_fill",
    )
    preset_id: str | None = Field(default=None, description="预设 ID（preset_id/provider_slug）")
    capabilities: dict | None = Field(default=None, description="能力映射 JSON")
    message: str | None = Field(default=None, description="聊天内容或说明")


class RouterResponse(BaseModel):
    intent: str
    status: str
    task_id: UUID | None = None
    detail: dict | None = None
    message: str | None = None


@router.post("", response_model=RouterResponse)
def route_command(
    payload: RouterCommand,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    """
    轻量 Router：区分聊天与任务。
    - intent=chat: 暂时回显 message，占位。
    - intent=create_task 且 task_type=preset_capability_fill: 创建 RULE_GEN 任务，携带 capabilities，立即投递 Celery。
    """
    if payload.intent == "chat":
        return RouterResponse(intent="chat", status="ok", message=payload.message or "")

    if payload.intent == "create_task":
        if payload.task_type != "preset_capability_fill":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported task_type; only preset_capability_fill is allowed for now.",
            )
        if not payload.preset_id or not payload.capabilities:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="preset_id and capabilities are required for preset_capability_fill",
            )

        # 创建 AgentTask
        task = agent_task_repository.create_task(
            db,
            task_type=AgentTaskType.RULE_GEN,
            provider_slug=payload.preset_id,
            config={
                "capabilities": payload.capabilities,
                "validation_issues": [],
            },
            created_by_id=current_user.id,
        )

        # 投递 Celery
        celery_result = agent_rule_gen_task.delay(str(task.id))
        agent_task_repository.update_status(
            db,
            task_id=task.id,
            status=AgentTaskStatus.QUEUED,
            celery_task_id=celery_result.id,
        )

        logger.info(
            "Router created rule_gen task %s for preset %s by user %s",
            task.id,
            payload.preset_id,
            current_user.id,
        )

        return RouterResponse(
            intent="create_task",
            status="queued",
            task_id=task.id,
            detail={"preset_id": payload.preset_id},
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Unsupported intent",
    )


__all__ = ["router"]
