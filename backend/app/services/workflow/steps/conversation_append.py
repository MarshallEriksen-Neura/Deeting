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
import uuid
from typing import TYPE_CHECKING, Any

from app.models.conversation import ConversationChannel
from app.repositories.conversation_message_repository import (
    ConversationMessageRepository,
)
from app.services.conversation.service import ConversationService
from app.services.conversation.session_service import ConversationSessionService
from app.services.conversation.topic_namer import (
    TOPIC_NAMING_META_KEY,
    extract_first_user_message,
)
from app.services.conversation.turn_index_sync import sync_redis_last_turn
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
    depends_on = ["response_transform", "spec_agent_detector"]

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
        # 重新生成时，用户消息已在历史中，跳过重复追加
        is_regenerate = ctx.get("conversation", "regenerate", False)
        if is_regenerate:
            user_messages = []
        assistant_id = req.get("assistant_id") or ctx.get("assistant", "id")
        assistant_msg = self._extract_assistant_message(
            ctx.get("response_transform", "response") or {}
        )
        if assistant_msg:
            self._append_tool_result_blocks(
                assistant_msg,
                ctx.get("execution", "tool_calls"),
            )

        # 添加 spec_agent_suggestion 到 assistant 消息的 meta_info
        spec_suggestion = ctx.get("spec_agent_detector", "suggestion")
        if spec_suggestion and assistant_msg:
            meta_info = assistant_msg.get("meta_info") or {}
            meta_info["spec_agent_suggestion"] = spec_suggestion
            assistant_msg["meta_info"] = meta_info

        used_persona_id = self._resolve_used_persona_id(ctx)

        if used_persona_id and ctx.db_session is not None:
            try:
                from app.services.assistant.assistant_routing_service import (
                    AssistantRoutingService,
                )

                routing_service = AssistantRoutingService(ctx.db_session)
                await routing_service.record_trial(uuid.UUID(str(used_persona_id)))
            except Exception as exc:
                logger.warning(
                    "assistant_routing_trial_failed session=%s exc=%s",
                    session_id,
                    exc,
                )

        channel = (
            ConversationChannel.EXTERNAL
            if ctx.is_external
            else ConversationChannel.INTERNAL
        )

        db_messages, redis_messages = self._prepare_messages(
            user_messages=user_messages,
            assistant_message=assistant_msg,
            used_persona_id=used_persona_id,
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

        session_uuid: uuid.UUID | None = None
        if ctx.db_session is not None:
            try:
                session_uuid = uuid.UUID(session_id)
            except Exception:
                session_uuid = None

        if redis_available and conv_service:
            try:
                # 使用分布式锁防止并发写入冲突（P1-4）
                from app.core.cache_keys import CacheKeys
                from app.core.distributed_lock import distributed_lock

                lock_key = CacheKeys.session_lock(session_id)

                async with distributed_lock(
                    lock_key, ttl=10, retry_times=3
                ) as acquired:
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
                        if ctx.db_session is not None and session_uuid is not None:
                            try:
                                await sync_redis_last_turn(
                                    redis=conv_service.redis,
                                    db_session=ctx.db_session,
                                    session_id=session_id,
                                    session_uuid=session_uuid,
                                )
                            except Exception as exc:
                                logger.warning(
                                    "conversation_sync_turn_failed session=%s exc=%s",
                                    session_id,
                                    exc,
                                )
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
                if session_uuid is None:
                    session_uuid = uuid.UUID(session_id)
                user_uuid = uuid.UUID(ctx.user_id) if ctx.user_id else None
                tenant_uuid = uuid.UUID(ctx.tenant_id) if ctx.tenant_id else None
                assistant_uuid = uuid.UUID(str(assistant_id)) if assistant_id else None
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

        # ===== 重新生成：LLM 成功后执行旧 assistant 消息的软删除 =====
        if is_regenerate:
            regenerate_turn_index = ctx.get(
                "conversation", "regenerate_turn_index", None
            )
            if regenerate_turn_index is not None:
                await self._soft_delete_old_assistant(
                    ctx=ctx,
                    conv_service=conv_service,
                    session_id=session_id,
                    turn_index=regenerate_turn_index,
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
        used_persona_id: str | None,
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
            reasoning_text = msg.get("reasoning_content")
            token_est = msg.get("token_estimate")
            meta_info = self._build_meta_info(msg, content)
            blocks = self._build_blocks(
                content_text=content_text,
                reasoning_text=reasoning_text if isinstance(reasoning_text, str) else None,
                tool_calls=msg.get("tool_calls"),
            )
            if blocks and not (meta_info or {}).get("blocks"):
                meta_info = {**(meta_info or {}), "blocks": blocks}

            normalized = {
                **msg,
                "content": content_text,
                "token_estimate": (
                    token_est
                    if token_est is not None
                    else self._estimate_tokens(content_for_tokens)
                ),
                "meta_info": meta_info,
            }
            if used_persona_id and msg.get("role") == "assistant":
                normalized["used_persona_id"] = used_persona_id
            db_messages.append(normalized)
            redis_messages.append({**normalized, "content": content_for_tokens})

        return db_messages, redis_messages

    @staticmethod
    def _resolve_used_persona_id(ctx: WorkflowContext) -> str | None:
        assistant_id = ctx.get("assistant", "id")
        if assistant_id:
            return str(assistant_id)
        candidates = ctx.get("assistant", "candidates") or []
        if isinstance(candidates, list) and candidates:
            first = candidates[0] if isinstance(candidates[0], dict) else None
            candidate_id = first.get("assistant_id") if first else None
            if candidate_id:
                return str(candidate_id)
        return None

    @staticmethod
    def _build_meta_info(
        message: dict[str, Any], content: Any
    ) -> dict[str, Any] | None:
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
            "reasoning_content",
        ):
            if message.get(key) is not None:
                extras[key] = message.get(key)
        if not isinstance(content, str) and content is not None:
            extras["content"] = content
        if extras:
            meta_info = {**(meta_info or {}), **extras}
        return meta_info or None

    @staticmethod
    def _build_blocks(
        *,
        content_text: str | None,
        reasoning_text: str | None = None,
        tool_calls: Any,
    ) -> list[dict[str, Any]] | None:
        blocks: list[dict[str, Any]] = []

        # 1. 优先处理显式的思维链字段
        if reasoning_text and reasoning_text.strip():
            blocks.append({"type": "thought", "content": reasoning_text.strip()})

        # 2. 处理正文（block-first：正文统一作为 text block）
        if content_text and content_text.strip():
            # dev 模式下不解析 <think> 等标签，避免多套协议导致维护成本上升。
            blocks.append({"type": "text", "content": content_text})

        if isinstance(tool_calls, list):
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                call_id = call.get("id")
                call_id = call_id if isinstance(call_id, str) and call_id else None
                function = call.get("function") or {}
                name = function.get("name") or call.get("name")
                args = function.get("arguments") or call.get("arguments")
                if args is None:
                    args_str = None
                elif isinstance(args, str):
                    args_str = args
                else:
                    args_str = json.dumps(args, ensure_ascii=False)
                block: dict[str, Any] = {
                    "type": "tool_call",
                    "toolName": name,
                    "toolArgs": args_str,
                }
                if call_id:
                    block["callId"] = call_id
                blocks.append(block)

        return blocks or None

    @classmethod
    def _append_tool_result_blocks(
        cls,
        assistant_message: dict[str, Any],
        tool_calls_log: Any,
    ) -> None:
        if not isinstance(assistant_message, dict):
            return
        result_blocks = cls._build_tool_result_blocks(tool_calls_log)
        if not result_blocks:
            return

        meta_info = assistant_message.get("meta_info")
        if not isinstance(meta_info, dict):
            meta_info = {}

        existing_blocks = meta_info.get("blocks")
        if isinstance(existing_blocks, list):
            base_blocks = list(existing_blocks)
        else:
            base_blocks = cls._build_blocks(
                content_text=(
                    assistant_message.get("content")
                    if isinstance(assistant_message.get("content"), str)
                    else None
                ),
                tool_calls=assistant_message.get("tool_calls"),
            ) or []

        meta_info["blocks"] = [*base_blocks, *result_blocks]
        assistant_message["meta_info"] = meta_info

    @staticmethod
    def _build_tool_result_blocks(tool_calls_log: Any) -> list[dict[str, Any]]:
        if not isinstance(tool_calls_log, list):
            return []

        blocks: list[dict[str, Any]] = []
        for call in tool_calls_log:
            if not isinstance(call, dict):
                continue
            result = call.get("output")
            success = call.get("success")
            if result is None and success is False:
                result = call.get("error")
            if result is None:
                continue

            block: dict[str, Any] = {
                "type": "tool_result",
                "result": result,
                "status": "error" if success is False else "success",
            }
            call_id = call.get("tool_call_id")
            if isinstance(call_id, str) and call_id:
                block["callId"] = call_id
            name = call.get("name")
            if isinstance(name, str) and name:
                block["toolName"] = name
            blocks.append(block)
        return blocks

    @staticmethod
    def _extract_assistant_message(response: dict[str, Any]) -> dict[str, Any] | None:
        choices = response.get("choices") if isinstance(response, dict) else None
        if not choices:
            return None
        first = choices[0]
        if isinstance(first, dict):
            return first.get("message")
        return None

    @staticmethod
    async def _soft_delete_old_assistant(
        *,
        ctx: WorkflowContext,
        conv_service: ConversationService | None,
        session_id: str,
        turn_index: int,
    ) -> None:
        """重新生成成功后，软删除旧的 assistant 消息（Redis + DB）"""
        # Redis 侧软删除
        if conv_service:
            try:
                await conv_service.delete_message(session_id, turn_index)
                logger.info(
                    "conversation_regenerate_deleted session=%s turn=%s",
                    session_id,
                    turn_index,
                )
            except Exception as exc:
                logger.warning(
                    "conversation_regenerate_redis_delete_failed session=%s exc=%s",
                    session_id,
                    exc,
                )
        # DB 侧软删除
        if ctx.db_session is not None:
            try:
                msg_repo = ConversationMessageRepository(ctx.db_session)
                await msg_repo.soft_delete_by_turn_index(
                    session_id=uuid.UUID(session_id),
                    turn_index=turn_index,
                )
            except Exception as exc:
                logger.warning(
                    "conversation_regenerate_db_delete_failed session=%s exc=%s",
                    session_id,
                    exc,
                )

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
