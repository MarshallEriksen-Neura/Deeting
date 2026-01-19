"""
路由亲和状态机

用于会话级别的路由亲和管理，优化 KV Cache 命中率。

状态转换：
- INIT -> EXPLORING: 首次请求，开始探索
- EXPLORING -> LOCKED: 探索期内选定最优上游
- LOCKED -> EXPLORING: 上游失败，重新探索
- LOCKED -> LOCKED: 持续使用同一上游
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import TYPE_CHECKING

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.utils.time_utils import Datetime

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class AffinityState(str, Enum):
    """亲和状态"""

    INIT = "init"  # 初始状态
    EXPLORING = "exploring"  # 探索期（尝试多个上游）
    LOCKED = "locked"  # 锁定期（固定使用一个上游）


@dataclass
class AffinityContext:
    """亲和上下文"""

    state: AffinityState
    locked_provider: str | None = None  # 锁定的上游 provider
    locked_item_id: str | None = None  # 锁定的 preset_item_id
    explore_count: int = 0  # 探索次数
    success_count: int = 0  # 成功次数
    failure_count: int = 0  # 失败次数
    last_updated: datetime | None = None
    lock_expires_at: datetime | None = None  # 锁定过期时间


class RoutingAffinityStateMachine:
    """路由亲和状态机"""

    def __init__(
        self,
        session_id: str,
        model: str,
        explore_threshold: int = 3,  # 探索期请求数阈值
        lock_duration: int = 3600,  # 锁定期时长（秒）
        failure_threshold: int = 3,  # 失败次数阈值（触发重新探索）
    ):
        """
        Args:
            session_id: 会话 ID
            model: 模型名称
            explore_threshold: 探索期请求数阈值（达到后锁定最优上游）
            lock_duration: 锁定期时长（秒）
            failure_threshold: 失败次数阈值（连续失败后重新探索）
        """
        self.session_id = session_id
        self.model = model
        self.explore_threshold = explore_threshold
        self.lock_duration = lock_duration
        self.failure_threshold = failure_threshold
        self._cache_key = CacheKeys.routing_affinity_state(session_id, model)

    async def get_context(self) -> AffinityContext:
        """获取当前亲和上下文"""
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            return AffinityContext(state=AffinityState.INIT)

        try:
            full_key = cache._make_key(self._cache_key)
            data = await redis_client.hgetall(full_key)
            if not data:
                return AffinityContext(state=AffinityState.INIT)

            # 解析 Redis Hash
            state = AffinityState(data.get(b"state", b"init").decode())
            locked_provider = data.get(b"locked_provider")
            locked_item_id = data.get(b"locked_item_id")
            explore_count = int(data.get(b"explore_count", 0))
            success_count = int(data.get(b"success_count", 0))
            failure_count = int(data.get(b"failure_count", 0))
            last_updated_str = data.get(b"last_updated")
            lock_expires_str = data.get(b"lock_expires_at")

            last_updated = None
            if last_updated_str:
                last_updated = datetime.fromisoformat(last_updated_str.decode())

            lock_expires_at = None
            if lock_expires_str:
                lock_expires_at = datetime.fromisoformat(lock_expires_str.decode())

            return AffinityContext(
                state=state,
                locked_provider=locked_provider.decode() if locked_provider else None,
                locked_item_id=locked_item_id.decode() if locked_item_id else None,
                explore_count=explore_count,
                success_count=success_count,
                failure_count=failure_count,
                last_updated=last_updated,
                lock_expires_at=lock_expires_at,
            )
        except Exception as exc:
            logger.warning("affinity_get_context_failed session=%s model=%s err=%s", self.session_id, self.model, exc)
            return AffinityContext(state=AffinityState.INIT)

    async def should_use_affinity(self) -> tuple[bool, str | None, str | None]:
        """
        判断是否应该使用亲和路由

        Returns:
            (should_use, provider, item_id)
            - should_use: 是否应该使用亲和路由
            - provider: 锁定的 provider（如果有）
            - item_id: 锁定的 preset_item_id（如果有）
        """
        ctx = await self.get_context()

        # 初始状态或探索期：不使用亲和
        if ctx.state in (AffinityState.INIT, AffinityState.EXPLORING):
            return False, None, None

        # 锁定期：检查是否过期
        if ctx.state == AffinityState.LOCKED:
            if ctx.lock_expires_at and Datetime.utcnow() > ctx.lock_expires_at:
                # 锁定已过期，重新探索
                await self._transition_to_exploring(ctx)
                return False, None, None

            # 锁定有效，使用亲和路由
            return True, ctx.locked_provider, ctx.locked_item_id

        return False, None, None

    async def record_request(
        self,
        provider: str,
        item_id: str,
        success: bool,
    ) -> None:
        """
        记录请求结果，更新状态机

        Args:
            provider: 使用的 provider
            item_id: 使用的 preset_item_id
            success: 请求是否成功
        """
        ctx = await self.get_context()

        if ctx.state == AffinityState.INIT:
            # 初始状态 -> 探索期
            await self._transition_to_exploring(ctx)
            ctx = await self.get_context()

        if ctx.state == AffinityState.EXPLORING:
            # 探索期：累计请求，达到阈值后锁定
            ctx.explore_count += 1
            if success:
                ctx.success_count += 1

            if ctx.explore_count >= self.explore_threshold:
                # 达到探索阈值，锁定当前上游
                await self._transition_to_locked(ctx, provider, item_id)
            else:
                # 继续探索
                await self._save_context(ctx)

        elif ctx.state == AffinityState.LOCKED:
            # 锁定期：记录成功/失败
            if success:
                ctx.success_count += 1
                ctx.failure_count = 0  # 重置失败计数
                await self._save_context(ctx)
            else:
                ctx.failure_count += 1
                if ctx.failure_count >= self.failure_threshold:
                    # 连续失败达到阈值，重新探索
                    logger.info(
                        "affinity_unlock_due_to_failures session=%s model=%s provider=%s failures=%d",
                        self.session_id,
                        self.model,
                        provider,
                        ctx.failure_count,
                    )
                    await self._transition_to_exploring(ctx)
                else:
                    await self._save_context(ctx)

    async def _transition_to_exploring(self, ctx: AffinityContext) -> None:
        """转换到探索期"""
        ctx.state = AffinityState.EXPLORING
        ctx.locked_provider = None
        ctx.locked_item_id = None
        ctx.explore_count = 0
        ctx.success_count = 0
        ctx.failure_count = 0
        ctx.lock_expires_at = None
        ctx.last_updated = Datetime.utcnow()
        await self._save_context(ctx)
        logger.debug("affinity_transition_to_exploring session=%s model=%s", self.session_id, self.model)

    async def _transition_to_locked(
        self,
        ctx: AffinityContext,
        provider: str,
        item_id: str,
    ) -> None:
        """转换到锁定期"""
        ctx.state = AffinityState.LOCKED
        ctx.locked_provider = provider
        ctx.locked_item_id = item_id
        ctx.lock_expires_at = Datetime.utcnow() + timedelta(seconds=self.lock_duration)
        ctx.last_updated = Datetime.utcnow()
        await self._save_context(ctx)
        logger.info(
            "affinity_locked session=%s model=%s provider=%s item=%s expires=%s",
            self.session_id,
            self.model,
            provider,
            item_id,
            ctx.lock_expires_at,
        )

    async def _save_context(self, ctx: AffinityContext) -> None:
        """保存上下文到 Redis"""
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            return

        try:
            full_key = cache._make_key(self._cache_key)
            payload = {
                "state": ctx.state.value,
                "explore_count": str(ctx.explore_count),
                "success_count": str(ctx.success_count),
                "failure_count": str(ctx.failure_count),
                "last_updated": ctx.last_updated.isoformat() if ctx.last_updated else Datetime.utcnow().isoformat(),
            }

            if ctx.locked_provider:
                payload["locked_provider"] = ctx.locked_provider
            if ctx.locked_item_id:
                payload["locked_item_id"] = ctx.locked_item_id
            if ctx.lock_expires_at:
                payload["lock_expires_at"] = ctx.lock_expires_at.isoformat()

            await redis_client.hset(full_key, mapping=payload)
            # 设置过期时间（锁定期 + 1 小时缓冲）
            ttl = self.lock_duration + 3600
            await redis_client.expire(full_key, ttl)
        except Exception as exc:
            logger.error("affinity_save_context_failed session=%s model=%s err=%s", self.session_id, self.model, exc)

    async def reset(self) -> None:
        """重置状态机（用于测试或手动干预）"""
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            return

        try:
            full_key = cache._make_key(self._cache_key)
            await redis_client.delete(full_key)
            logger.info("affinity_reset session=%s model=%s", self.session_id, self.model)
        except Exception as exc:
            logger.error("affinity_reset_failed session=%s model=%s err=%s", self.session_id, self.model, exc)
