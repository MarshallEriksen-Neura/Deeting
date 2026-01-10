"""
Bridge Agent Token 服务（内部网关专用）。

职责：
- 为 user+agent 生成/轮转 JWT token（HS256）
- 记录版本并缓存到 Redis，支持单活与重置
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import cache, settings
from app.models import BridgeAgentToken
from app.utils.time_utils import Datetime

_AGENT_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$")
_REDIS_KEY_TEMPLATE = "bridge:agent_token_version:{user_id}:{agent_id}"


@dataclass
class BridgeAgentTokenResult:
    token: str
    expires_at: datetime
    version: int


def normalize_agent_id(value: str | None) -> str:
    return (value or "").strip()


def generate_agent_id() -> str:
    return "agent_" + uuid.uuid4().hex[:10]


def validate_agent_id(agent_id: str) -> None:
    if not agent_id:
        raise ValueError("missing agent_id")
    if not _AGENT_ID_RE.fullmatch(agent_id):
        raise ValueError("invalid agent_id")


def _create_jwt_token(
    *,
    user_id: str,
    agent_id: str,
    version: int,
    issued_at: datetime,
    expires_at: datetime,
) -> str:
    secret = (settings.JWT_SECRET_KEY or "").strip()
    if not secret:
        raise RuntimeError("missing JWT_SECRET_KEY for bridge agent token")
    payload: dict[str, Any] = {
        "type": "bridge_agent",
        "sub": user_id,
        "agent_id": agent_id,
        "ver": int(version),
        "iat": issued_at,
        "exp": expires_at,
        "iss": settings.BRIDGE_AGENT_TOKEN_ISS,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


class BridgeAgentTokenService:
    def __init__(self, *, session: AsyncSession, redis=None) -> None:
        self.session = session
        # 避免未初始化时触发属性访问异常
        self.redis = redis or getattr(cache, "_redis", None)

    @staticmethod
    def _redis_key(*, user_id: uuid.UUID, agent_id: str) -> str:
        return _REDIS_KEY_TEMPLATE.format(user_id=str(user_id), agent_id=agent_id)

    async def _cache_version(self, *, user_id: uuid.UUID, agent_id: str, version: int, expires_at: datetime) -> None:
        if not self.redis:
            return
        exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=UTC)
        ttl_seconds = int((exp - Datetime.now()).total_seconds())
        if ttl_seconds <= 0:
            ttl_seconds = 1
        payload = {"version": int(version), "expires_at": exp.isoformat()}
        try:
            import json

            await self.redis.set(
                self._redis_key(user_id=user_id, agent_id=agent_id),
                json.dumps(payload),
                ex=ttl_seconds,
            )
        except Exception:
            # 缓存失败不阻断主流程
            return

    async def _fetch_record(self, *, user_id: uuid.UUID, agent_id: str) -> BridgeAgentToken | None:
        stmt = select(BridgeAgentToken).where(
            BridgeAgentToken.user_id == user_id,
            BridgeAgentToken.agent_id == agent_id,
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def issue_token(
        self,
        *,
        user_id: uuid.UUID,
        agent_id: str,
        reset: bool = False,
    ) -> BridgeAgentTokenResult:
        validate_agent_id(agent_id)
        now = Datetime.now()
        record = await self._fetch_record(user_id=user_id, agent_id=agent_id)

        is_expired = bool(record and record.expires_at <= now)
        should_rotate = reset or is_expired or record is None

        if not should_rotate and record is not None:
            token = _create_jwt_token(
                user_id=str(user_id),
                agent_id=agent_id,
                version=record.version,
                issued_at=record.issued_at,
                expires_at=record.expires_at,
            )
            await self._cache_version(user_id=user_id, agent_id=agent_id, version=record.version, expires_at=record.expires_at)
            return BridgeAgentTokenResult(token=token, expires_at=record.expires_at, version=record.version)

        next_version = 1 if record is None else int(record.version) + 1
        issued_at = now
        expires_at = issued_at + timedelta(days=int(settings.BRIDGE_AGENT_TOKEN_EXPIRE_DAYS))

        token = _create_jwt_token(
            user_id=str(user_id),
            agent_id=agent_id,
            version=next_version,
            issued_at=issued_at,
            expires_at=expires_at,
        )

        if record is None:
            record = BridgeAgentToken(
                user_id=user_id,
                agent_id=agent_id,
                version=next_version,
                issued_at=issued_at,
                expires_at=expires_at,
            )
            self.session.add(record)
        else:
            record.version = next_version
            record.issued_at = issued_at
            record.expires_at = expires_at
            self.session.add(record)

        await self.session.commit()
        await self.session.refresh(record)

        await self._cache_version(user_id=user_id, agent_id=agent_id, version=record.version, expires_at=record.expires_at)

        return BridgeAgentTokenResult(token=token, expires_at=record.expires_at, version=record.version)


__all__ = [
    "BridgeAgentTokenResult",
    "BridgeAgentTokenService",
    "generate_agent_id",
    "normalize_agent_id",
    "validate_agent_id",
]
