from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from redis.asyncio import Redis

from app.core.cache import cache
from app.core.cache_invalidation import CacheInvalidator
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.core.logging import logger as app_logger
from app.models.conversation import ConversationChannel
from app.services.memory.scheduler import memory_scheduler


class ConversationService:
    """
    管理会话上下文的 Redis 窗口与摘要触发。
    - 追加消息：Lua 原子分配 turn_index、累计 token、剪裁窗口
    - 触发摘要：达到阈值时投递 Celery 任务，避免请求链路阻塞
    """

    APPEND_LUA = """
    -- KEYS[1]: msgs list key
    -- KEYS[2]: meta hash key
    -- ARGV:
    -- 1 role
    -- 2 content
    -- 3 token_estimate
    -- 4 is_truncated (0/1)
    -- 5 name
    -- 6 max_turns
    -- 7 max_turns_overflow
    -- 8 flush_threshold_tokens
    local msgs = KEYS[1]
    local meta = KEYS[2]
    local role = ARGV[1]
    local content = ARGV[2]
    local token_est = tonumber(ARGV[3]) or 0
    local is_truncated = tonumber(ARGV[4]) or 0
    local name = ARGV[5]
    local max_turns = tonumber(ARGV[6])
    local max_turns_over = tonumber(ARGV[7])
    local flush_tokens = tonumber(ARGV[8])

    local turn = redis.call('HINCRBY', meta, 'last_turn', 1)
    local total_tokens = redis.call('HINCRBY', meta, 'total_tokens', token_est)

    local msg = cjson.encode({
        role = role,
        content = content,
        token_estimate = token_est,
        is_truncated = is_truncated == 1,
        name = (name ~= '' and name or cjson.null),
        turn_index = turn
    })
    redis.call('RPUSH', msgs, msg)
    local len = redis.call('LLEN', msgs)
    if len > max_turns_over then
        local trim_start = len - max_turns
        redis.call('LTRIM', msgs, trim_start, -1)
        len = redis.call('LLEN', msgs)
    end
    local should_flush = 0
    if total_tokens >= flush_tokens then
        should_flush = 1
    end
    return {total_tokens, len, should_flush, turn}
    """

    def __init__(self, redis: Redis | None = None) -> None:
        self.redis: Redis = redis or getattr(cache, "_redis", None)
        if not self.redis:
            raise RuntimeError("Redis 未初始化，无法使用 ConversationService")
        self._append_script = self.redis.register_script(self.APPEND_LUA)
        self._invalidator = CacheInvalidator()

    # ===== 公共接口 =====

    async def append_messages(
        self,
        session_id: str,
        messages: Sequence[dict[str, Any]],
        channel: ConversationChannel = ConversationChannel.INTERNAL,
    ) -> dict[str, Any]:
        """
        将消息追加到滑动窗口，并在超阈值时触发异步摘要。
        message 字段: role, content, token_estimate, is_truncated, name(optional)
        """
        if not messages:
            return {"should_flush": False, "last_turn": None}

        max_turns = (
            settings.CONVERSATION_ACTIVE_WINDOW_TURNS_INTERNAL
            if channel == ConversationChannel.INTERNAL
            else settings.CONVERSATION_ACTIVE_WINDOW_TURNS_EXTERNAL
        )
        max_turns_overflow = max(
            max_turns,
            int(max_turns * settings.CONVERSATION_WINDOW_OVERFLOW_RATIO),
        )
        ttl = cache.jitter_ttl(settings.CONVERSATION_REDIS_TTL_SECONDS)

        last_turn = None
        should_flush = False
        total_tokens = 0
        msgs_key = CacheKeys.conversation_messages(session_id)
        meta_key = CacheKeys.conversation_meta(session_id)

        await self._init_meta(meta_key, channel)

        for msg in messages:
            res = await self._append_script(
                keys=[msgs_key, meta_key],
                args=[
                    msg.get("role"),
                    msg.get("content", ""),
                    msg.get("token_estimate", 0),
                    1 if msg.get("is_truncated") else 0,
                    msg.get("name") or "",
                    max_turns,
                    max_turns_overflow,
                    settings.CONVERSATION_FLUSH_THRESHOLD_TOKENS,
                ],
            )
            if not res or len(res) < 4:
                raise RuntimeError("追加消息失败：Lua 脚本返回异常")
            total_tokens, _, flush_flag, turn = res
            last_turn = int(turn)
            msg["turn_index"] = last_turn
            should_flush = should_flush or bool(flush_flag)

        await self.redis.hset(
            meta_key, mapping={"last_active_at": datetime.now(UTC).isoformat()}
        )
        await self._refresh_ttl(session_id, ttl)

        # 触碰记忆调度（不阻塞主流程）
        try:
            await memory_scheduler.touch_session(session_id)
        except Exception:
            pass

        # 已在做摘要则不重复派单
        if should_flush and not await self._is_summarizing(session_id):
            await self._mark_summarizing(session_id, True)
            from app.tasks.conversation import conversation_summarize

            job = conversation_summarize.delay(session_id)
            await self._redis_hset(
                meta_key,
                {"summary_job_id": job.id or "", "summarizing": 1},
            )
            app_logger.info(
                f"conversation_summary_triggered session={session_id} job_id={job.id}"
            )

        return {
            "should_flush": should_flush,
            "last_turn": last_turn,
            "total_tokens": int(total_tokens),
        }

    async def load_window(self, session_id: str) -> dict[str, Any]:
        """读取当前窗口（messages/meta/summary）"""
        msgs_key = CacheKeys.conversation_messages(session_id)
        meta_key = CacheKeys.conversation_meta(session_id)
        summary_key = CacheKeys.conversation_summary(session_id)

        pipe = self.redis.pipeline()
        pipe.lrange(msgs_key, 0, -1)
        pipe.hgetall(meta_key)
        pipe.get(summary_key)
        msgs_raw, meta_raw, summary_raw = await pipe.execute()

        messages = [json.loads(m.decode()) for m in msgs_raw] if msgs_raw else []
        meta = (
            {k.decode(): self._decode_meta_value(v) for k, v in meta_raw.items()}
            if meta_raw
            else {}
        )
        summary = json.loads(summary_raw.decode()) if summary_raw else None

        return {"messages": messages, "meta": meta, "summary": summary}

    async def update_summary_cache(
        self,
        session_id: str,
        payload: dict[str, Any],
    ) -> None:
        """写入摘要缓存并刷新 TTL"""
        summary_key = CacheKeys.conversation_summary(session_id)
        ttl = cache.jitter_ttl(settings.CONVERSATION_REDIS_TTL_SECONDS)
        await self.redis.set(summary_key, json.dumps(payload), ex=ttl)
        await self._refresh_ttl(session_id, ttl)
        await self._invalidator.on_conversation_summary_updated(session_id)

    async def clear_summarizing(self, session_id: str) -> None:
        await self._redis_hset(
            CacheKeys.conversation_meta(session_id),
            {"summarizing": 0, "summary_job_id": ""},
        )

    # ===== 内部工具 =====

    async def _refresh_ttl(self, session_id: str, ttl: int) -> None:
        msgs_key = CacheKeys.conversation_messages(session_id)
        meta_key = CacheKeys.conversation_meta(session_id)
        summary_key = CacheKeys.conversation_summary(session_id)
        await self.redis.expire(msgs_key, ttl)
        await self.redis.expire(meta_key, ttl)
        await self.redis.expire(summary_key, ttl)

    async def _is_summarizing(self, session_id: str) -> bool:
        meta_key = CacheKeys.conversation_meta(session_id)
        val = await self.redis.hget(meta_key, "summarizing")
        return bool(val) and val.decode() not in ("0", b"0")

    async def _mark_summarizing(self, session_id: str, status: bool) -> None:
        await self._redis_hset(
            CacheKeys.conversation_meta(session_id),
            {"summarizing": 1 if status else 0},
        )

    async def _redis_hset(self, key: str, mapping: dict[str, Any]) -> None:
        encoded = {k: self._encode_value(v) for k, v in mapping.items()}
        await self.redis.hset(key, mapping=encoded)

    async def _init_meta(self, meta_key: str, channel: ConversationChannel) -> None:
        """初始化基础 meta 字段（仅在缺失时）"""
        pipe = self.redis.pipeline()
        pipe.hsetnx(meta_key, "last_turn", 0)
        pipe.hsetnx(meta_key, "total_tokens", 0)
        pipe.hsetnx(meta_key, "last_summary_version", 0)
        pipe.hsetnx(meta_key, "summarizing", 0)
        pipe.hsetnx(meta_key, "summary_job_id", "")
        pipe.hset(meta_key, "channel", channel.value)
        pipe.hset(meta_key, "last_active_at", datetime.now(UTC).isoformat())
        pipe.hsetnx(meta_key, "first_message_at", datetime.now(UTC).isoformat())
        await pipe.execute()

    @staticmethod
    def _encode_value(val: Any) -> Any:
        if isinstance(val, bool):
            return 1 if val else 0
        return val

    @staticmethod
    def _decode_meta_value(val: Any) -> Any:
        if isinstance(val, bytes):
            s = val.decode()
            if s.isdigit():
                return int(s)
            return s
        return val


# Helper for tasks without DI
def get_conversation_service() -> ConversationService:
    return ConversationService()
