from __future__ import annotations

from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache_keys import CacheKeys
from app.models.conversation import ConversationMessage


def _parse_turn(raw: object | None) -> int:
    if raw is None:
        return 0
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode()
    try:
        return int(raw)
    except Exception:
        return 0


async def sync_redis_last_turn(
    *,
    redis: Redis,
    db_session: AsyncSession,
    session_id: str,
    session_uuid: UUID | None = None,
) -> int:
    """
    将 Redis 的 last_turn 与数据库最大 turn_index 对齐。

    适用于 Redis 元数据丢失/过期后，避免 turn_index 回退导致 DB 去重丢消息。
    """
    meta_key = CacheKeys.conversation_meta(session_id)
    redis_last_turn = _parse_turn(await redis.hget(meta_key, "last_turn"))

    resolved_uuid = session_uuid or UUID(session_id)
    result = await db_session.execute(
        select(func.max(ConversationMessage.turn_index)).where(
            ConversationMessage.session_id == resolved_uuid
        )
    )
    db_max_turn = int(result.scalar() or 0)

    if db_max_turn > redis_last_turn:
        await redis.hset(meta_key, mapping={"last_turn": db_max_turn})
        redis_last_turn = db_max_turn

    return redis_last_turn
