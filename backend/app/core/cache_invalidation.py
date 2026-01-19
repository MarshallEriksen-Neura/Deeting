"""
缓存失效管理

职责：
- 统一管理缓存失效逻辑
- 提供事件驱动的失效机制
- 避免业务代码中散落的 Key 操作

核心概念:

1. 事件 -> Key 矩阵
   定义每类变更事件需要失效的 Key 列表

2. 失效策略
   - 精确删除: 删除特定 Key
   - 前缀删除: 删除匹配前缀的所有 Key（使用 SCAN）
   - 版本失效: 递增版本号，读取时对比

事件类型:

1. ProviderPreset 变更
   - 失效: gw:preset:*, gw:routing:*, gw:pricing:{preset}, gw:limit:{preset}

2. Pricing/Limit 变更
   - 失效: gw:pricing:{preset}, gw:limit:{preset}, gw:quota:{tenant}

3. 模板/上游路径更新
   - 失效: gw:preset:{cap}:{model}:{channel}, gw:upstream_tpl:{preset_item}

4. API Key 状态变更
   - 失效: gw:api_key:{id}, gw:api_key:list:{tenant}
   - 写入: gw:api_key:revoked:{id}（如果是吊销）

5. 租户配额更新
   - 失效: gw:quota:{tenant}, gw:rl:{tenant}:*

6. 全局配置变更
   - 递增: gw:cfg:version

7. 会话历史缓存
   - 失效: gw:conv:{session}:meta/msgs/summary/lock/summary_job，gw:conv:{session}:embed*

使用方式:
    from app.core.cache_invalidation import CacheInvalidator

    # 单个事件
    await invalidator.on_preset_updated(preset_id)

    # 批量事件
    await invalidator.invalidate([
        ("preset_updated", {"preset_id": 1}),
        ("pricing_updated", {"preset_id": 1}),
    ])

并发保护:
- 失效时对单 Key 使用短期分布式锁
- 锁超时应短（如 100ms）且带重试
- 使用 pipeline + UNLINK 批量删除避免阻塞

发布前检查:
- 变更评审需列出受影响的事件与 Key
- 上线脚本可在迁移后调用失效函数
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Sequence

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.logging import logger
from app.utils.time_utils import Datetime


class CacheInvalidator:
    """
    事件驱动的缓存失效器。
    当前实现聚焦于：
      - ProviderPreset 相关缓存
      - API Key 缓存
      - 配额/限流缓存
    """

    def __init__(self):
        self.version_key = CacheKeys.cfg_version()
        self.updated_at_key = CacheKeys.cfg_updated_at()

    async def invalidate(self, events: Sequence[tuple[str, dict]]) -> None:
        """批量处理失效事件"""
        tasks = []
        for name, payload in events:
            handler = getattr(self, f"on_{name}", None)
            if handler:
                tasks.append(handler(**payload))
            else:
                logger.warning(f"unknown_invalidation_event name={name}")
        if tasks:
            await asyncio.gather(*tasks)

    # === 事件处理 ===

    async def on_preset_updated(self, preset_id: str | None = None) -> None:
        """ProviderPreset 结构/可见性/路由/模板变更"""
        keys = []
        if preset_id:
            keys += [
                CacheKeys.pricing(preset_id),
                CacheKeys.limit(preset_id),
                CacheKeys.provider_preset(preset_id),
            ]
        await self._delete_keys(keys)
        await self._clear_prefix(f"{CacheKeys.prefix}:preset:")
        await self._clear_prefix(f"{CacheKeys.prefix}:routing:")
        # 活跃列表缓存
        await self._delete_keys([CacheKeys.provider_preset_active_list()])
        await self.bump_version()

    async def on_pricing_updated(self, preset_id: str) -> None:
        await self._delete_keys([CacheKeys.pricing(preset_id)])
        await self.bump_version()

    async def on_limit_updated(self, preset_id: str) -> None:
        await self._delete_keys([CacheKeys.limit(preset_id)])
        await self.bump_version()

    async def on_api_key_changed(self, key_id: str, tenant_id: str | None = None) -> None:
        keys = [CacheKeys.api_key(key_id), CacheKeys.api_key_revoked(key_id)]
        if tenant_id:
            keys.append(CacheKeys.api_key_list(tenant_id))
        await self._delete_keys(keys)
        await self._clear_prefix(f"rl:ak:{key_id}:")
        await self.bump_version()

    async def on_quota_updated(self, tenant_id: str) -> None:
        await self._delete_keys([CacheKeys.quota_tenant(tenant_id)])
        await self._clear_prefix(f"rl:tenant:{tenant_id}:")
        await self.bump_version()

    async def on_upstream_template_updated(self, preset_item_id: str) -> None:
        await self._delete_keys([CacheKeys.upstream_template(preset_item_id)])
        await self.bump_version()

    async def on_conversation_reset(self, session_id: str) -> None:
        """会话关闭/删除时清理上下文缓存"""
        keys = [
            CacheKeys.conversation_meta(session_id),
            CacheKeys.conversation_messages(session_id),
            CacheKeys.conversation_summary(session_id),
            CacheKeys.conversation_lock(session_id),
            CacheKeys.conversation_summary_job(session_id),
        ]
        await self._delete_keys(keys)
        await self._clear_prefix(f"conv:{session_id}:embed")
        await self.bump_version()

    async def on_conversation_summary_updated(self, session_id: str) -> None:
        """摘要重算时强制刷新缓存"""
        await self._delete_keys([CacheKeys.conversation_summary(session_id)])
        await self.bump_version()

    async def on_bandit_updated(self, preset_item_id: str | None = None) -> None:
        """Bandit 臂状态变更或策略参数更新时失效缓存"""
        if preset_item_id:
            await self._delete_keys([CacheKeys.bandit_state(preset_item_id)])
        else:
            await self._clear_prefix("bandit:")
        await self.bump_version()

    async def on_secret_rotated(self, provider: str) -> None:
        """上游凭证轮换：失效 provider 级别缓存"""
        await self._clear_prefix(f"upstream_cred:{provider}")
        await self.bump_version()

    async def on_provider_instance_changed(self, user_id: str | None = None) -> None:
        """
        ProviderInstance 创建/更新/删除后失效列表缓存。
        - 公共实例影响所有包含公共实例的视图，因此直接清理前缀。
        - 私有实例至少清理对应用户列表前缀，同样使用前缀清理简化。
        """
        await self._clear_prefix(f"{CacheKeys.prefix}:pi:list:")
        await self.bump_version()

    async def on_provider_model_changed(
        self,
        instance_id: str | None = None,
        capability: str | None = None,
        model_id: str | None = None,
    ) -> None:
        """
        ProviderModel 变更后失效模型列表与候选缓存。
        - 精确删除实例列表；
        - capability/model 变化可能影响候选列表，使用前缀清理。
        """
        keys = []
        if instance_id:
            keys.append(CacheKeys.provider_model_list(instance_id))
        await self._delete_keys(keys)
        await self._clear_prefix(f"{CacheKeys.prefix}:pm:cand:")
        await self._clear_prefix(f"{CacheKeys.prefix}:pi:list:")
        await self.bump_version()

    async def on_provider_credentials_changed(self, instance_id: str | None = None) -> None:
        """
        凭证变更后清理对应实例的凭证列表缓存。
        """
        keys = []
        if instance_id:
            keys.append(CacheKeys.provider_credentials(instance_id))
        await self._delete_keys(keys)
        await self.bump_version()

    async def on_provider_credentials_changed(self, instance_id: str | None = None) -> None:
        """
        多凭证变更后，失效凭证列表缓存与路由候选缓存。
        """
        keys = []
        if instance_id:
            keys.append(CacheKeys.provider_credentials(instance_id))
        await self._delete_keys(keys)
        await self._clear_prefix(f"{CacheKeys.prefix}:pm:cand:")
        await self.bump_version()

    # === 基础操作 ===

    async def _delete_keys(self, keys: Iterable[str]) -> None:
        redis = getattr(cache, "_redis", None)
        if not redis:
            return
        ks = [cache._make_key(k) for k in keys if k]
        if ks:
            try:
                await redis.unlink(*ks)
            except Exception as exc:
                logger.warning(f"cache_unlink_failed keys={ks} exc={exc}")

    async def _clear_prefix(self, prefix: str) -> None:
        redis = getattr(cache, "_redis", None)
        if not redis:
            return
        pattern = f"{cache._make_key(prefix)}*"
        try:
            keys = await redis.keys(pattern)
            if keys:
                await redis.unlink(*keys)
        except Exception as exc:
            logger.warning(f"cache_clear_prefix_failed prefix={prefix} exc={exc}")

    # === 版本号管理 ===

    async def bump_version(self) -> int:
        """递增配置版本并记录更新时间"""
        redis = getattr(cache, "_redis", None)
        if not redis:
            return 0
        try:
            version = await redis.incr(cache._make_key(self.version_key))
            await redis.set(cache._make_key(self.updated_at_key), Datetime.now().isoformat(), ex=24 * 3600)
            return version
        except Exception as exc:
            logger.warning(f"cache_bump_version_failed exc={exc}")
            return 0

    async def get_version(self) -> int | None:
        redis = getattr(cache, "_redis", None)
        if not redis:
            return None
        try:
            raw = await redis.get(cache._make_key(self.version_key))
            return int(raw) if raw else None
        except Exception:
            return None

    async def get_updated_at(self) -> str | None:
        redis = getattr(cache, "_redis", None)
        if not redis:
            return None
        try:
            raw = await redis.get(cache._make_key(self.updated_at_key))
            return raw.decode() if raw else None
        except Exception:
            return None
