"""
ConversationAppendStep: 会话窗口追加

职责：
- 将本次用户消息与助手回复写入 Redis 滑动窗口
- 达阈值时触发异步摘要（由 ConversationService 内部完成）
- 在响应中透传 session_id 便于前端续聊
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Any

from app.models.conversation import ConversationChannel
from app.services.conversation.session_service import ConversationSessionService
from app.services.conversation.service import ConversationService
from app.services.conversation.topic_namer import TOPIC_NAMING_META_KEY, extract_first_user_message
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class ConversationAppendStep(BaseStep):
    """
    会话写入步骤
    """

    name = "conversation_append"
    depends_on = ["response_transform"]

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        # 仅 chat 能力处理；流式暂跳过
        if ctx.capability != "chat":
            return StepResult(status=StepStatus.SUCCESS, message="skip_non_chat")
        if ctx.is_external:
            return StepResult(status=StepStatus.SUCCESS, message="skip_external")
        if ctx.get("conversation", "skip", False):
            return StepResult(status=StepStatus.SUCCESS, message="skip_conversation")
        if ctx.get("upstream_call", "stream"):
            return StepResult(status=StepStatus.SUCCESS, message="skip_streaming")

        session_id = ctx.get("conversation", "session_id") or (
            (ctx.get("validation", "validated") or {}).get("session_id")
        )
        if not session_id:
            return StepResult(status=StepStatus.SUCCESS, message="no_session_id")

        try:
            conv_service = ConversationService()
        except Exception as exc:
            logger.warning(f"ConversationAppend skipped (redis unavailable): {exc}")
            return StepResult(status=StepStatus.SUCCESS, message="redis_unavailable")

        req = ctx.get("validation", "validated") or {}
        user_messages: list[dict[str, Any]] = req.get("messages", []) or []
        assistant_id = req.get("assistant_id")
        assistant_msg = self._extract_assistant_message(
            ctx.get("response_transform", "response") or {}
        )

        msgs_to_append: list[dict[str, Any]] = []
        msgs_to_append.extend(self._with_tokens(user_messages))
        if assistant_msg:
            msgs_to_append.append(self._with_tokens([assistant_msg])[0])

        channel = (
            ConversationChannel.EXTERNAL
            if ctx.is_external
            else ConversationChannel.INTERNAL
        )

        # 使用分布式锁防止并发写入冲突（P1-4）
        from app.core.distributed_lock import distributed_lock
        from app.core.cache_keys import CacheKeys
        
        lock_key = CacheKeys.session_lock(session_id)
        
        async with distributed_lock(lock_key, ttl=10, retry_times=3) as acquired:
            if not acquired:
                logger.warning(
                    "conversation_append_lock_failed session=%s trace=%s",
                    session_id,
                    ctx.trace_id,
                )
                # 锁获取失败，降级处理（不阻塞请求）
                return StepResult(
                    status=StepStatus.SUCCESS,
                    message="lock_acquisition_failed",
                )
            
            # 持有锁，执行会话追加
            result = await conv_service.append_messages(
                session_id=session_id,
                messages=msgs_to_append,
                channel=channel,
            )
            if ctx.db_session is not None:
                try:
                    session_uuid = uuid.UUID(session_id)
                    user_uuid = uuid.UUID(ctx.user_id) if ctx.user_id else None
                    tenant_uuid = uuid.UUID(ctx.tenant_id) if ctx.tenant_id else None
                    assistant_uuid = (
                        uuid.UUID(str(assistant_id)) if assistant_id else None
                    )
                    message_count = result.get("last_turn") if isinstance(result, dict) else None
                    session_service = ConversationSessionService(ctx.db_session)
                    await session_service.touch_session(
                        session_id=session_uuid,
                        user_id=user_uuid,
                        tenant_id=tenant_uuid,
                        assistant_id=assistant_uuid,
                        channel=channel,
                        message_count=message_count,
                    )
                except Exception as exc:
                    logger.warning(
                        "conversation_session_touch_failed session=%s exc=%s",
                        session_id,
                        exc,
                    )

        await self._maybe_schedule_topic_naming(
            ctx=ctx,
            conv_service=conv_service,
            session_id=session_id,
            messages=user_messages,
            appended_count=len(msgs_to_append),
            last_turn=result.get("last_turn") if isinstance(result, dict) else None,
        )

        # 将 session_id 透传到响应
        response = ctx.get("response_transform", "response") or {}
        if isinstance(response, dict):
            response.setdefault("session_id", session_id)
            ctx.set("response_transform", "response", response)

        return StepResult(
            status=StepStatus.SUCCESS,
            data={
                "session_id": session_id,
                "appended": len(msgs_to_append),
                "should_flush": result.get("should_flush"),
            },
        )

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, int(len(text) / 4)) if text else 1

    def _with_tokens(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        enriched = []
        for msg in messages:
            token_est = msg.get("token_estimate")
            content = msg.get("content", "")
            enriched.append(
                {
                    **msg,
                    "token_estimate": token_est
                    if token_est is not None
                    else self._estimate_tokens(str(content)),
                }
            )
        return enriched

    @staticmethod
    def _extract_assistant_message(response: dict[str, Any]) -> dict[str, Any] | None:
        choices = response.get("choices") if isinstance(response, dict) else None
        if not choices:
            return None
        first = choices[0]
        if isinstance(first, dict):
            return first.get("message")
        return None

    async def _maybe_schedule_topic_naming(
        self,
        *,
        ctx: WorkflowContext,
        conv_service: ConversationService,
        session_id: str,
        messages: list[dict[str, Any]],
        appended_count: int,
        last_turn: int | None,
    ) -> None:
        if not ctx.user_id:
            return
        if not last_turn or last_turn != appended_count:
            return
        first_message = extract_first_user_message(messages)
        if not first_message:
            return
        first_message = first_message[:1000]

        from app.core.cache_keys import CacheKeys

        meta_key = CacheKeys.conversation_meta(session_id)
        try:
            existing = await conv_service.redis.hget(meta_key, TOPIC_NAMING_META_KEY)
            if isinstance(existing, (bytes, bytearray)):
                existing = existing.decode()
            if existing and str(existing) not in ("0", ""):
                return
            await conv_service._redis_hset(meta_key, {TOPIC_NAMING_META_KEY: 1})
        except Exception:
            return

        try:
            from app.tasks.conversation import conversation_topic_naming

            conversation_topic_naming.delay(
                session_id=session_id,
                user_id=str(ctx.user_id),
                first_message=first_message,
            )
        except Exception as exc:
            logger.warning(
                "conversation_topic_naming_schedule_failed session=%s exc=%s",
                session_id,
                exc,
            )
