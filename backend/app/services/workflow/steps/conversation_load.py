"""
ConversationLoadStep: 会话上下文加载

职责：
- 确定 session_id（若缺失则生成）
- 从 Redis 读取窗口消息 / 摘要 / meta
- 组装可供上游使用的 messages（summary + window + 本次用户消息）
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Any

from app.services.conversation.service import ConversationService
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class ConversationLoadStep(BaseStep):
    """
    会话加载步骤

    从上下文读取:
        - validation.validated: 请求体

    写入上下文:
        - conversation.session_id
        - conversation.window_messages
        - conversation.summary
        - conversation.merged_messages
    """

    name = "conversation_load"
    depends_on = ["validation"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        # 仅内部通道需要历史
        if ctx.is_external:
            return StepResult(status=StepStatus.SUCCESS, message="skip_external")
        if ctx.get("conversation", "skip", False):
            return StepResult(status=StepStatus.SUCCESS, message="skip_conversation")

        request_data = ctx.get("validation", "validated") or {}

        session_id = (
            request_data.get("session_id")
            or ctx.get("conversation", "session_id")
            or uuid.uuid4().hex
        )
        # 回写到请求数据，便于后续步骤/响应透传
        request_data["session_id"] = session_id
        ctx.set("validation", "validated", request_data)
        ctx.set("conversation", "session_id", session_id)

        session_assistant_id = None
        if ctx.db_session is not None:
            try:
                from sqlalchemy import select

                from app.models.conversation import ConversationSession

                session_uuid = uuid.UUID(session_id)
                result = await ctx.db_session.execute(
                    select(ConversationSession.assistant_id).where(
                        ConversationSession.id == session_uuid
                    )
                )
                session_assistant_id = result.scalar_one_or_none()
            except Exception:
                session_assistant_id = None

        if session_assistant_id:
            ctx.set("conversation", "session_assistant_id", session_assistant_id)
            if not request_data.get("assistant_id"):
                request_data["assistant_id"] = session_assistant_id
                ctx.set("validation", "validated", request_data)

        # 无 Redis 时降级跳过
        try:
            conv_service = ConversationService()
        except Exception as exc:
            logger.warning(f"ConversationLoad skipped (redis unavailable): {exc}")
            return StepResult(
                status=StepStatus.SUCCESS, data={"session_id": session_id}
            )

        window = await conv_service.load_window(session_id)
        window_messages_raw: list[dict[str, Any]] = window.get("messages", []) or []
        window_messages_raw = sorted(
            window_messages_raw, key=lambda m: m.get("turn_index", 0)
        )

        # ===== 重新生成：仅从内存中过滤旧 assistant 消息 =====
        # 实际的 Redis/DB 软删除延迟到 AppendStep（LLM 成功后），确保失败可回滚
        is_regenerate = bool(request_data.get("regenerate"))
        regenerate_turn_index: int | None = None
        if is_regenerate and window_messages_raw:
            # 从尾部找到最后一条未删除的 assistant 消息
            for idx in range(len(window_messages_raw) - 1, -1, -1):
                msg = window_messages_raw[idx]
                if msg.get("role") == "assistant" and not msg.get("is_deleted"):
                    regenerate_turn_index = msg.get("turn_index")
                    break
            if regenerate_turn_index is not None:
                # 仅从内存窗口中过滤（供 LLM 上下文使用），不执行持久化删除
                window_messages_raw = [
                    m
                    for m in window_messages_raw
                    if m.get("turn_index") != regenerate_turn_index
                ]
                logger.info(
                    "conversation_regenerate_filtered session=%s turn=%s",
                    session_id,
                    regenerate_turn_index,
                )

        # 透传 regenerate 标记和待删除 turn_index，供后续 append step 使用
        ctx.set("conversation", "regenerate", is_regenerate)
        ctx.set("conversation", "regenerate_turn_index", regenerate_turn_index)

        window_messages: list[dict[str, Any]] = [
            {
                "role": m.get("role"),
                "content": m.get("content"),
                **({"name": m.get("name")} if m.get("name") else {}),
            }
            for m in window_messages_raw
        ]
        summary = window.get("summary")

        # 合成上游 messages：先 summary，再窗口消息，再本次请求消息
        merged_messages: list[dict[str, Any]] = []
        if summary and summary.get("summary_text"):
            merged_messages.append(
                {
                    "role": "system",
                    "content": f"[SUMMARY]\n{summary.get('summary_text')}",
                }
            )
        merged_messages.extend(window_messages)
        if is_regenerate:
            # regenerate 时 Redis 窗口已包含完整对话历史（user/assistant）
            # 仅从请求中提取 system 消息（如 system prompt），避免重复
            merged_messages.extend(
                m
                for m in request_data.get("messages", [])
                if m.get("role") == "system"
            )
        else:
            merged_messages.extend(request_data.get("messages", []))

        ctx.set("conversation", "window_messages", window_messages)
        ctx.set("conversation", "window_messages_raw", window_messages_raw)
        ctx.set("conversation", "summary", summary)
        ctx.set("conversation", "merged_messages", merged_messages)
        ctx.set("conversation", "meta", window.get("meta", {}))

        ctx.emit_status(
            stage="remember",
            step=self.name,
            state="success",
            code="context.loaded",
            meta={
                "count": len(window_messages),
                "has_summary": bool(summary and summary.get("summary_text")),
            },
        )

        logger.debug(
            f"conversation_loaded session={session_id} "
            f"window_msgs={len(window_messages)} summary={'yes' if summary else 'no'}"
        )

        return StepResult(
            status=StepStatus.SUCCESS,
            data={"session_id": session_id, "window_messages": len(window_messages)},
        )
