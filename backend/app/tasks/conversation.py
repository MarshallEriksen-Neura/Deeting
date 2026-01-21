from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from loguru import logger
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.logging import setup_logging
from app.models import (
    ConversationChannel,
    ConversationMessage,
    ConversationSession,
    ConversationStatus,
    ConversationSummary,
)
from app.services.conversation.service import get_conversation_service
from app.services.conversation.summarizer import SummarizerService
from app.services.conversation.topic_namer import generate_conversation_title
from app.utils.time_utils import Datetime


@celery_app.task(name="conversation.summarize")
def conversation_summarize(session_id: str) -> str:
    """
    异步摘要任务：
    - 读取 Redis 窗口
    - 生成摘要
    - 回写 Redis + DB
    - 刷新缓存版本
    """

    setup_logging()
    return asyncio.run(_run_summarize(session_id))


@celery_app.task(name="conversation.summary_idle_check")
def conversation_summary_idle_check(session_id: str) -> str:
    """
    空闲触发摘要任务：
    - 检查最后活跃时间，仍活跃则跳过
    - 确认有新消息且未在摘要中，触发异步摘要
    """
    setup_logging()
    return asyncio.run(_run_summary_idle_check(session_id))


def _decode_str(val: Any | None) -> str | None:
    if val is None:
        return None
    if isinstance(val, (bytes, bytearray)):
        return val.decode()
    return str(val)


def _decode_int(val: Any | None, default: int = 0) -> int:
    raw = _decode_str(val)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        try:
            return int(float(raw))
        except Exception:
            return default


def _decode_float(val: Any | None, default: float = 0.0) -> float:
    raw = _decode_str(val)
    if raw is None:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _decode_bool(val: Any | None) -> bool:
    raw = _decode_str(val)
    if raw is None:
        return False
    return raw not in ("0", "", "false", "False")


async def _run_summary_idle_check(session_id: str) -> str:
    from app.core.cache_keys import CacheKeys

    try:
        svc = get_conversation_service()
    except Exception as exc:
        logger.error(
            f"conversation_summary_idle_redis_unavailable session={session_id} exc={exc}"
        )
        return "redis_unavailable"

    redis = svc.redis
    last_active_key = CacheKeys.conversation_summary_last_active(session_id)
    pending_key = CacheKeys.conversation_summary_pending_task(session_id)

    try:
        last_active_raw = await redis.get(last_active_key)
        await redis.delete(pending_key)
        if not last_active_raw:
            return "no_last_active"

        last_active = _decode_float(last_active_raw)
        if time.time() - last_active < settings.CONVERSATION_SUMMARY_IDLE_SECONDS:
            return "skip_active"

        meta_key = CacheKeys.conversation_meta(session_id)
        summary_key = CacheKeys.conversation_summary(session_id)
        meta_raw = await redis.hgetall(meta_key)
        if not meta_raw:
            return "no_meta"

        last_turn = _decode_int(meta_raw.get(b"last_turn"), 0)
        if last_turn <= 0:
            return "no_messages"

        if _decode_bool(meta_raw.get(b"summarizing")):
            return "already_summarizing"

        summary_raw = await redis.get(summary_key)
        if summary_raw:
            summary_payload = json.loads(_decode_str(summary_raw) or "{}")
            covered_to = _decode_int(summary_payload.get("covered_to_turn"), 0)
            if covered_to >= last_turn:
                return "no_new_messages"
            generated_at = summary_payload.get("generated_at")
            if generated_at:
                try:
                    last_summary_at = Datetime.from_iso_string(str(generated_at))
                    if (
                        Datetime.now() - last_summary_at
                    ).total_seconds() < settings.CONVERSATION_SUMMARY_MIN_INTERVAL_SECONDS:
                        return "min_interval"
                except Exception:
                    pass

        job = conversation_summarize.delay(session_id)
        await svc._redis_hset(
            key=meta_key,
            mapping={"summarizing": 1, "summary_job_id": job.id or ""},
        )
        logger.info(
            f"conversation_summary_idle_triggered session={session_id} job_id={job.id}"
        )
        return "queued"
    except Exception as exc:
        logger.error(f"conversation_summary_idle_failed session={session_id} exc={exc}")
        return "failed"


async def _run_summarize(session_id: str) -> str:
    try:
        svc = get_conversation_service()
    except Exception as exc:
        logger.error(f"conversation_summarize_redis_unavailable session={session_id} exc={exc}")
        return "redis_unavailable"
    try:
        payload = await svc.load_window(session_id)
        messages: list[dict[str, Any]] = sorted(
            payload.get("messages", []), key=lambda m: m.get("turn_index", 0)
        )
        meta: dict[str, Any] = payload.get("meta", {}) or {}

        if not messages:
            await svc.clear_summarizing(session_id)
            logger.info(f"conversation_summarize_skip_empty session={session_id}")
            return "no_messages"

        summarizer = SummarizerService()
        summary_text = await summarizer.summarize(messages)
        covered_from = messages[0].get("turn_index", 1)
        covered_to = messages[-1].get("turn_index", covered_from)
        token_estimate = sum(int(m.get("token_estimate", 0)) for m in messages)
        current_version = int(meta.get("last_summary_version", 0))
        new_version = current_version + 1

        # 回写 Redis 缓存
        summary_payload = {
            "version": new_version,
            "summary_text": summary_text,
            "covered_from_turn": covered_from,
            "covered_to_turn": covered_to,
            "token_estimate": token_estimate,
            "generated_at": Datetime.now().isoformat(),
        }
        await svc.update_summary_cache(session_id, summary_payload)

        # 回写 DB
        await _persist_summary(
            session_id=session_id,
            summary_payload=summary_payload,
            messages=messages,
            meta=meta,
        )

        # 更新 meta 状态：重置 total_tokens 为当前窗口估算，解除 summarizing
        from app.core.cache_keys import CacheKeys

        meta_key = CacheKeys.conversation_meta(session_id)
        await svc._redis_hset(
            key=meta_key,
            mapping={
                "total_tokens": token_estimate,
                "last_summary_version": new_version,
                "summarizing": 0,
                "summary_job_id": "",
            },
        )

        logger.info(
            f"conversation_summarize_done session={session_id} version={new_version} covered={covered_from}-{covered_to}"
        )
        return "ok"
    except Exception as exc:
        await svc.clear_summarizing(session_id)
        logger.error(f"conversation_summarize_failed session={session_id} exc={exc}")
        return "failed"


async def _persist_summary(
    session_id: str,
    summary_payload: dict[str, Any],
    messages: list[dict[str, Any]],
    meta: dict[str, Any],
) -> None:
    session_uuid = uuid.UUID(session_id)
    async with AsyncSessionLocal() as db:
        try:
            def _parse_dt(val: Any) -> Any | None:
                if not val:
                    return None
                if isinstance(val, str):
                    try:
                        from datetime import datetime

                        return datetime.fromisoformat(val.replace("Z", "+00:00"))
                    except Exception:
                        return None
                return val

            # 会话存在校验/创建
            stmt = select(ConversationSession).where(
                ConversationSession.id == session_uuid
            )
            result = await db.execute(stmt)
            session_obj: ConversationSession | None = result.scalar_one_or_none()
            if not session_obj:
                session_obj = ConversationSession(
                    id=session_uuid,
                    channel=meta.get("channel", ConversationChannel.INTERNAL),
                    status=ConversationStatus.ACTIVE,
                    message_count=len(messages),
                    last_summary_version=summary_payload["version"],
                    last_active_at=_parse_dt(meta.get("last_active_at")),
                    first_message_at=_parse_dt(meta.get("first_message_at")),
                )
                db.add(session_obj)
            else:
                session_obj.message_count = max(
                    session_obj.message_count or 0, meta.get("last_turn", 0)
                )
                session_obj.last_summary_version = summary_payload["version"]
                session_obj.last_active_at = _parse_dt(meta.get("last_active_at")) or session_obj.last_active_at
                if not session_obj.first_message_at:
                    session_obj.first_message_at = _parse_dt(meta.get("first_message_at"))

            # 写入消息（幂等）
            if messages:
                msg_rows = []
                for m in messages:
                    msg_rows.append(
                        {
                            "id": uuid.uuid4(),
                            "session_id": session_uuid,
                            "turn_index": m.get("turn_index", 0),
                            "role": m.get("role"),
                            "name": m.get("name"),
                            "content": m.get("content"),
                            "token_estimate": int(m.get("token_estimate", 0)),
                            "is_truncated": bool(m.get("is_truncated", False)),
                        }
                    )
                stmt = (
                    insert(ConversationMessage)
                    .values(msg_rows)
                    .on_conflict_do_nothing(
                        index_elements=["session_id", "turn_index"]
                    )
                )
                await db.execute(stmt)

            preset_val = settings.CONVERSATION_SUMMARIZER_PRESET_ID
            preset_uuid = uuid.UUID(preset_val) if preset_val else None

            previous_summary_id = None
            if summary_payload.get("version", 0) > 1:
                prev_stmt = select(ConversationSummary.id).where(
                    ConversationSummary.session_id == session_uuid,
                    ConversationSummary.version == summary_payload["version"] - 1,
                )
                previous_summary_id = (await db.execute(prev_stmt)).scalar_one_or_none()

            summary = ConversationSummary(
                session_id=session_uuid,
                version=summary_payload["version"],
                summary_text=summary_payload["summary_text"],
                covered_from_turn=summary_payload["covered_from_turn"],
                covered_to_turn=summary_payload["covered_to_turn"],
                previous_summary_id=previous_summary_id,
                start_message_id=None,
                end_message_id=None,
                token_estimate=summary_payload["token_estimate"],
                summarizer_model=None,
                summarizer_preset_id=preset_uuid,
            )
            db.add(summary)
            await db.commit()
        except (SQLAlchemyError, ValueError) as exc:
            await db.rollback()
            logger.error(f"conversation_summary_persist_failed session={session_id} exc={exc}")


@celery_app.task(name="conversation.topic_naming")
def conversation_topic_naming(session_id: str, user_id: str, first_message: str) -> str:
    """
    异步话题命名任务：
    - 读取用户秘书配置中的 model_name
    - 调用用户自有模型生成标题
    - 写回 conversation_session.title
    """

    setup_logging()
    return asyncio.run(_run_topic_naming(session_id, user_id, first_message))


async def _run_topic_naming(session_id: str, user_id: str, first_message: str) -> str:
    async with AsyncSessionLocal() as db:
        return await generate_conversation_title(
            db,
            session_id=session_id,
            user_id=user_id,
            first_message=first_message,
        )
