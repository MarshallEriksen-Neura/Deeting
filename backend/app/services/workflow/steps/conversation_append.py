"""
ConversationAppendStep: 会话窗口追加

职责：
- 将本次用户消息与助手回复写入 Redis 滑动窗口
- 达阈值时触发异步摘要（由 ConversationService 内部完成）
- 在响应中透传 session_id 便于前端续聊
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import TYPE_CHECKING, Any

from app.models.conversation import ConversationChannel
from app.services.conversation.session_service import ConversationSessionService
from app.repositories.conversation_message_repository import ConversationMessageRepository
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

        req = ctx.get("validation", "validated") or {}
        user_messages: list[dict[str, Any]] = req.get("messages", []) or []
        assistant_id = req.get("assistant_id")
        assistant_msg = self._extract_assistant_message(
            ctx.get("response_transform", "response") or {}
        )

        channel = (
            ConversationChannel.EXTERNAL
            if ctx.is_external
            else ConversationChannel.INTERNAL
        )

        db_messages, redis_messages = self._prepare_messages(
            user_messages=user_messages,
            assistant_message=assistant_msg,
        )

        conv_service: ConversationService | None = None
        result: dict[str, Any] = {"should_flush": False, "last_turn": None}
        redis_available = True
        try:
            conv_service = ConversationService()
        except Exception as exc:
            redis_available = False
            logger.warning(
                "ConversationAppend redis unavailable, fallback to db: %s", exc
            )

        if redis_available and conv_service:
            try:
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
                    try:
                        result = await conv_service.append_messages(
                            session_id=session_id,
                            messages=redis_messages,
                            channel=channel,
                        )
                    except Exception as exc:
                        redis_available = False
                        logger.warning(
                            "conversation_append_redis_failed session=%s exc=%s",
                            session_id,
                            exc,
                        )
            except Exception as exc:
                redis_available = False
                logger.warning(
                    "conversation_append_lock_error session=%s exc=%s",
                    session_id,
                    exc,
                )

        if redis_available:
            for idx, msg in enumerate(db_messages):
                if idx < len(redis_messages):
                    msg["turn_index"] = redis_messages[idx].get("turn_index")

        if ctx.db_session is not None:
            try:
                session_uuid = uuid.UUID(session_id)
                user_uuid = uuid.UUID(ctx.user_id) if ctx.user_id else None
                tenant_uuid = uuid.UUID(ctx.tenant_id) if ctx.tenant_id else None
                assistant_uuid = (
                    uuid.UUID(str(assistant_id)) if assistant_id else None
                )
                session_service = ConversationSessionService(ctx.db_session)
                if redis_available:
                    message_count = (
                        result.get("last_turn") if isinstance(result, dict) else None
                    )
                    await session_service.touch_session(
                        session_id=session_uuid,
                        user_id=user_uuid,
                        tenant_id=tenant_uuid,
                        assistant_id=assistant_uuid,
                        channel=channel,
                        message_count=message_count,
                    )
                else:
                    turn_indexes = await session_service.reserve_turn_indexes(
                        session_id=session_uuid,
                        user_id=user_uuid,
                        tenant_id=tenant_uuid,
                        assistant_id=assistant_uuid,
                        channel=channel,
                        count=len(db_messages),
                    )
                    for msg, turn_index in zip(db_messages, turn_indexes, strict=False):
                        msg["turn_index"] = turn_index
                try:
                    message_repo = ConversationMessageRepository(ctx.db_session)
                    await message_repo.bulk_insert_messages(
                        session_id=session_uuid,
                        messages=db_messages,
                    )
                except Exception as exc:
                    logger.warning(
                        "conversation_message_persist_failed session=%s exc=%s",
                        session_id,
                        exc,
                    )
            except Exception as exc:
                logger.warning(
                    "conversation_session_touch_failed session=%s exc=%s",
                    session_id,
                    exc,
                )
        elif not redis_available:
            logger.warning(
                "conversation_append_db_unavailable session=%s trace=%s",
                session_id,
                ctx.trace_id,
            )

        if conv_service:
            await self._maybe_schedule_topic_naming(
                ctx=ctx,
                conv_service=conv_service,
                session_id=session_id,
                messages=user_messages,
                appended_count=len(db_messages),
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
                "appended": len(db_messages),
                "should_flush": result.get("should_flush"),
            },
        )

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, int(len(text) / 4)) if text else 1

    @staticmethod
    def _content_for_tokens(content: Any) -> str:
        if isinstance(content, str):
            return content
        if content is None:
            return ""
        try:
            return json.dumps(content, ensure_ascii=False)
        except TypeError:
            return str(content)

    def _prepare_messages(
        self,
        *,
        user_messages: list[dict[str, Any]],
        assistant_message: dict[str, Any] | None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        raw_messages = list(user_messages)
        if assistant_message:
            raw_messages.append(assistant_message)

        db_messages: list[dict[str, Any]] = []
        redis_messages: list[dict[str, Any]] = []

        for msg in raw_messages:
            content = msg.get("content")
            content_text = content if isinstance(content, str) else None
            content_for_tokens = self._content_for_tokens(content)
            token_est = msg.get("token_estimate")
            meta_info = self._build_meta_info(msg, content)
            blocks = self._build_blocks(
                content_text=content_text,
                tool_calls=msg.get("tool_calls"),
            )
            if blocks and not (meta_info or {}).get("blocks"):
                meta_info = {**(meta_info or {}), "blocks": blocks}

            normalized = {
                **msg,
                "content": content_text,
                "token_estimate": token_est
                if token_est is not None
                else self._estimate_tokens(content_for_tokens),
                "meta_info": meta_info,
            }
            db_messages.append(normalized)
            redis_messages.append({**normalized, "content": content_for_tokens})

        return db_messages, redis_messages

    @staticmethod
    def _build_meta_info(message: dict[str, Any], content: Any) -> dict[str, Any] | None:
        meta_info = message.get("meta_info") or {}
        extras = {}
        for key in (
            "tool_calls",
            "tool_call_id",
            "function_call",
            "attachments",
            "image_url",
            "audio",
            "modalities",
        ):
            if message.get(key) is not None:
                extras[key] = message.get(key)
        if not isinstance(content, str) and content is not None:
            extras["content"] = content
        if extras:
            meta_info = {**meta_info, **extras}
        return meta_info or None

    @staticmethod
    def _build_blocks(
        *,
        content_text: str | None,
        tool_calls: Any,
    ) -> list[dict[str, Any]] | None:
        blocks: list[dict[str, Any]] = []
        if content_text:
            think_regex = re.compile(r"<think>([\\s\\S]*?)</think>", re.IGNORECASE)
            last_index = 0
            for match in think_regex.finditer(content_text):
                if match.start() > last_index:
                    text = content_text[last_index:match.start()]
                    if text.strip():
                        blocks.append({"type": "text", "content": text})
                thought = match.group(1).strip()
                if thought:
                    blocks.append({"type": "thought", "content": thought})
                last_index = match.end()
            if last_index < len(content_text):
                tail = content_text[last_index:]
                if tail.strip():
                    blocks.append({"type": "text", "content": tail})
            if not blocks and content_text.strip():
                blocks.append({"type": "text", "content": content_text})

        if isinstance(tool_calls, list):
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                function = call.get("function") or {}
                name = function.get("name") or call.get("name")
                args = function.get("arguments") or call.get("arguments")
                if args is None:
                    args_str = None
                elif isinstance(args, str):
                    args_str = args
                else:
                    args_str = json.dumps(args, ensure_ascii=False)
                blocks.append(
                    {
                        "type": "tool_call",
                        "toolName": name,
                        "toolArgs": args_str,
                    }
                )

        return blocks or None

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
