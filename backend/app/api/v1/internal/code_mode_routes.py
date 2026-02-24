from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent_plugins.builtins.deeting_core_sdk.plugin import DeetingCoreSdkPlugin
from app.agent_plugins.core.context import ConcretePluginContext
from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import CodeModeExecution, User
from app.repositories.code_mode_execution_repository import CodeModeExecutionRepository
from app.services.orchestrator.context import Channel, WorkflowContext

router = APIRouter(prefix="/code-mode", tags=["Code Mode"])


class CodeModeReplayRequest(BaseModel):
    code: str | None = Field(default=None, description="重放时覆盖代码")
    session_id: str | None = Field(default=None, description="重放时覆盖 session_id")
    language: str = Field(default="python", description="执行语言")
    execution_timeout: int = Field(default=30, ge=1, le=300, description="执行超时（秒）")
    dry_run: bool = Field(default=False, description="是否仅校验")
    tool_plan: list[dict[str, Any]] | None = Field(
        default=None,
        description="重放时覆盖 tool_plan",
    )


def _to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if isinstance(dt, datetime) else None


def _serialize_execution(record: CodeModeExecution) -> dict[str, Any]:
    return {
        "id": str(record.id),
        "execution_id": record.execution_id,
        "user_id": str(record.user_id),
        "session_id": record.session_id,
        "trace_id": record.trace_id,
        "language": record.language,
        "status": record.status,
        "format_version": record.format_version,
        "runtime_protocol_version": record.runtime_protocol_version,
        "runtime_context": record.runtime_context,
        "tool_plan_results": record.tool_plan_results,
        "runtime_tool_calls": record.runtime_tool_calls,
        "render_blocks": record.render_blocks,
        "error": record.error,
        "error_code": record.error_code,
        "duration_ms": record.duration_ms,
        "request_meta": record.request_meta,
        "created_at": _to_iso(record.created_at),
    }


async def _load_execution_for_user(
    *,
    db: AsyncSession,
    user_id: uuid.UUID,
    identifier: str,
) -> CodeModeExecution:
    repo = CodeModeExecutionRepository(db)
    record = await repo.get_by_identifier(identifier, user_id=user_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "CODE_MODE_EXECUTION_NOT_FOUND",
                "message": f"execution '{identifier}' not found",
            },
        )
    return record


def _build_replay_context(
    *,
    record: CodeModeExecution,
    user: User,
    replay_session_id: str,
) -> WorkflowContext:
    runtime_context = (
        record.runtime_context if isinstance(record.runtime_context, dict) else {}
    )
    identity = runtime_context.get("identity")
    request = runtime_context.get("request")
    permissions = runtime_context.get("permissions")

    workflow_context = WorkflowContext(
        channel=Channel.INTERNAL,
        user_id=str(user.id),
        session_id=replay_session_id,
        trace_id=uuid.uuid4().hex,
    )
    if isinstance(identity, dict):
        workflow_context.tenant_id = identity.get("tenant_id")
        workflow_context.api_key_id = identity.get("api_key_id")
    if isinstance(request, dict):
        workflow_context.capability = request.get("capability")
        workflow_context.requested_model = request.get("requested_model")
        workflow_context.client_ip = request.get("client_ip")
        workflow_context.user_agent = request.get("user_agent")
    if isinstance(permissions, dict):
        scopes = permissions.get("scopes")
        if isinstance(scopes, list):
            workflow_context.set("auth", "scopes", [str(item) for item in scopes])
        allowed_models = permissions.get("allowed_models")
        if isinstance(allowed_models, list):
            workflow_context.set(
                "external_auth",
                "allowed_models",
                [str(item) for item in allowed_models],
            )
    return workflow_context


@router.get("/executions/{execution_identifier}")
async def get_code_mode_execution(
    execution_identifier: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    record = await _load_execution_for_user(
        db=db,
        user_id=uuid.UUID(str(user.id)),
        identifier=execution_identifier,
    )
    return _serialize_execution(record)


@router.post("/executions/{execution_identifier}/replay")
async def replay_code_mode_execution(
    execution_identifier: str,
    payload: CodeModeReplayRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    record = await _load_execution_for_user(
        db=db,
        user_id=uuid.UUID(str(user.id)),
        identifier=execution_identifier,
    )

    source_tool_plan = []
    if isinstance(record.tool_plan_results, dict):
        request_tool_plan = record.tool_plan_results.get("request")
        if isinstance(request_tool_plan, list):
            source_tool_plan = request_tool_plan

    final_code = payload.code if payload.code is not None else record.code
    final_tool_plan = payload.tool_plan if payload.tool_plan is not None else source_tool_plan
    final_session_id = payload.session_id or record.session_id

    plugin = DeetingCoreSdkPlugin()
    plugin._context = ConcretePluginContext(
        plugin_name=plugin.metadata.name,
        plugin_id=plugin.metadata.name,
        user_id=uuid.UUID(str(user.id)),
        session_id=final_session_id,
    )
    workflow_context = _build_replay_context(
        record=record,
        user=user,
        replay_session_id=final_session_id,
    )

    execution_result = await plugin.handle_execute_code_plan(
        code=final_code,
        session_id=final_session_id,
        language=payload.language or record.language or "python",
        execution_timeout=payload.execution_timeout,
        dry_run=payload.dry_run,
        tool_plan=final_tool_plan,
        __context__=workflow_context,
    )
    return {
        "replay_of": str(record.id),
        "source_execution_id": record.execution_id,
        "result": execution_result,
    }


__all__ = ["router"]
