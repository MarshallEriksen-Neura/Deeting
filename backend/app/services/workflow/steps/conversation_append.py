"""
ConversationAppendStep: 会话窗口追加

职责：
- 将本次用户消息与助手回复写入 Redis 滑动窗口
- 达阈值时触发异步摘要（由 ConversationService 内部完成）
- 在响应中透传 session_id 便于前端续聊
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.models.conversation import ConversationChannel
from app.services.conversation.service import ConversationService
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
