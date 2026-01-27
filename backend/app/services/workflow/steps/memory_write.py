"""
MemoryWriteStep: 外部通道记忆写入（异步）

职责：
- 外部通道：基于单条用户消息触发记忆判定与写入（后台任务）
- 内部通道：保持不变（由 conversation_append/stream callback 负责）
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import TYPE_CHECKING

from app.services.memory import external_memory
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class MemoryWriteStep(BaseStep):
    name = "memory_write"
    depends_on = ["response_transform"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        if ctx.capability != "chat":
            return StepResult(status=StepStatus.SUCCESS, message="skip_non_chat")
        if not ctx.is_external:
            return StepResult(status=StepStatus.SUCCESS, message="skip_internal")
        if not ctx.is_success:
            return StepResult(status=StepStatus.SUCCESS, message="skip_failed")
        if ctx.get("upstream_call", "stream"):
            return StepResult(status=StepStatus.SUCCESS, message="skip_streaming")

        user_id = ctx.get("external_memory", "user_id") or ctx.user_id
        if not user_id:
            return StepResult(status=StepStatus.SUCCESS, message="no_user")
        try:
            user_uuid = uuid.UUID(str(user_id))
        except (ValueError, TypeError):
            return StepResult(status=StepStatus.SUCCESS, message="invalid_user")

        text = external_memory.extract_user_message(ctx.get("validation", "request"))
        if not text:
            return StepResult(status=StepStatus.SUCCESS, message="no_text")

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return StepResult(status=StepStatus.SUCCESS, message="no_loop")

        task = loop.create_task(
            external_memory.persist_external_memory(
                user_id=user_uuid,
                text=text,
                db_session=ctx.db_session,
                path=ctx.get("external_memory", "path"),
            )
        )

        def _log_task_error(t: asyncio.Task) -> None:
            try:
                exc = t.exception()
            except Exception as err:
                logger.warning("external_memory_task_exception trace_id=%s err=%s", ctx.trace_id, err)
                return
            if exc:
                logger.warning("external_memory_task_failed trace_id=%s err=%s", ctx.trace_id, exc)

        task.add_done_callback(_log_task_error)
        return StepResult(status=StepStatus.SUCCESS, message="scheduled")
