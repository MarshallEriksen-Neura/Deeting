"""
API Key Repository

职责:
- 封装 api_key 及相关表的数据库访问
- 提供 CRUD 操作
- 支持按 key_hash 快速查询
- 处理关联数据（scopes, rate_limit, quotas, ip_whitelist）

方法清单:
- get_by_id(id) -> ApiKey | None
- get_by_key_hash(key_hash) -> ApiKey | None
- get_by_tenant(tenant_id, status?) -> list[ApiKey]
- get_by_user(user_id, status?) -> list[ApiKey]
- create(data) -> ApiKey
- update(id, data) -> ApiKey
- revoke(id, reason) -> ApiKey
- delete(id) -> bool
- add_scope(api_key_id, scope) -> ApiKeyScope
- remove_scope(api_key_id, scope_id) -> bool
- update_rate_limit(api_key_id, data) -> ApiKeyRateLimit
- add_quota(api_key_id, quota) -> ApiKeyQuota
- update_quota_usage(api_key_id, quota_type, delta) -> ApiKeyQuota
- reset_quota(api_key_id, quota_type) -> ApiKeyQuota
- add_ip_whitelist(api_key_id, ip_pattern) -> ApiKeyIpWhitelist
- remove_ip_whitelist(api_key_id, ip_id) -> bool
- record_usage(api_key_id, request_count, token_count, cost, error_count) -> None
- get_usage_stats(api_key_id, start_date, end_date) -> list[ApiKeyUsage]

使用示例:
    from app.repositories.api_key import ApiKeyRepository

    repo = ApiKeyRepository(session)
    key = await repo.get_by_key_hash(computed_hash)
    if key and key.status == ApiKeyStatus.ACTIVE:
        ...
"""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.api_key import (
    ApiKey,
    ApiKeyIpWhitelist,
    ApiKeyQuota,
    ApiKeyRateLimit,
    ApiKeyScope,
    ApiKeyStatus,
    ApiKeyUsage,
    QuotaType,
    ScopeType,
)


class ApiKeyRepository:
    """
    API Key 数据访问层

    所有数据库操作封装在此，Service 层不直接访问 ORM
    """

    def __init__(self, session: AsyncSession):
        self.session = session

    # ============================================================
    # 基础 CRUD
    # ============================================================

    async def get_by_id(self, api_key_id: UUID) -> ApiKey | None:
        """根据 ID 获取 API Key（包含关联数据）"""
        stmt = (
            select(ApiKey)
            .options(
                selectinload(ApiKey.scopes),
                selectinload(ApiKey.rate_limit),
                selectinload(ApiKey.quotas),
                selectinload(ApiKey.ip_whitelist),
            )
            .where(ApiKey.id == api_key_id)
        )
        res = await self.session.execute(stmt)
        return res.scalars().first()

    async def get_by_key_hash(self, key_hash: str) -> ApiKey | None:
        """根据 key_hash 获取 API Key（最常用的查询）"""
        stmt = (
            select(ApiKey)
            .options(
                selectinload(ApiKey.scopes),
                selectinload(ApiKey.rate_limit),
                selectinload(ApiKey.quotas),
                selectinload(ApiKey.ip_whitelist),
            )
            .where(ApiKey.key_hash == key_hash)
        )
        res = await self.session.execute(stmt)
        return res.scalars().first()

    async def get_by_tenant(
        self,
        tenant_id: UUID,
        status: ApiKeyStatus | None = None,
    ) -> list[ApiKey]:
        """获取租户的所有 API Key"""
        stmt = select(ApiKey).where(ApiKey.tenant_id == tenant_id)
        if status:
            stmt = stmt.where(ApiKey.status == status)
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_by_user(
        self,
        user_id: UUID,
        status: ApiKeyStatus | None = None,
    ) -> list[ApiKey]:
        """获取用户的所有 API Key"""
        stmt = select(ApiKey).where(ApiKey.user_id == user_id)
        if status:
            stmt = stmt.where(ApiKey.status == status)
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def list_keys(
        self,
        tenant_id: UUID | None = None,
        user_id: UUID | None = None,
        status: ApiKeyStatus | None = None,
    ) -> list[ApiKey]:
        """
        列出 API Key（支持多条件筛选）

        Args:
            tenant_id: 租户 ID 筛选
            user_id: 用户 ID 筛选
            status: 状态筛选

        Returns:
            符合条件的 API Key 列表
        """
        stmt = select(ApiKey).options(
            selectinload(ApiKey.scopes),
            selectinload(ApiKey.rate_limit),
            selectinload(ApiKey.quotas),
            selectinload(ApiKey.ip_whitelist),
        )

        if tenant_id:
            stmt = stmt.where(ApiKey.tenant_id == tenant_id)
        if user_id:
            stmt = stmt.where(ApiKey.user_id == user_id)
        if status:
            stmt = stmt.where(ApiKey.status == status)

        stmt = stmt.order_by(ApiKey.created_at.desc())
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def create(self, data: dict) -> ApiKey:
        """创建 API Key"""
        obj = ApiKey(**data)
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update(self, api_key_id: UUID, data: dict) -> ApiKey | None:
        """更新 API Key"""
        obj = await self.get_by_id(api_key_id)
        if not obj:
            return None
        for k, v in data.items():
            if hasattr(obj, k) and v is not None:
                setattr(obj, k, v)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def revoke(
        self,
        api_key_id: UUID,
        reason: str,
    ) -> ApiKey | None:
        """吊销 API Key"""
        obj = await self.get_by_id(api_key_id)
        if not obj:
            return None
        obj.status = ApiKeyStatus.REVOKED
        obj.revoked_at = datetime.utcnow()
        obj.revoked_reason = reason
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def delete(self, api_key_id: UUID) -> bool:
        """删除 API Key"""
        res = await self.session.execute(
            delete(ApiKey).where(ApiKey.id == api_key_id)
        )
        await self.session.flush()
        return res.rowcount > 0

    async def update_last_used(self, api_key_id: UUID) -> None:
        """更新最近使用时间"""
        await self.session.execute(
            update(ApiKey)
            .where(ApiKey.id == api_key_id)
            .values(last_used_at=datetime.utcnow())
        )
        await self.session.flush()

    # ============================================================
    # Scope 操作
    # ============================================================

    async def add_scope(
        self,
        api_key_id: UUID,
        scope_type: ScopeType,
        scope_value: str,
        permission: str = "allow",
    ) -> ApiKeyScope:
        """添加权限范围"""
        scope = ApiKeyScope(
            api_key_id=api_key_id,
            scope_type=scope_type,
            scope_value=scope_value,
            permission=permission,
        )
        self.session.add(scope)
        await self.session.flush()
        await self.session.refresh(scope)
        return scope

    async def remove_scope(self, api_key_id: UUID, scope_id: UUID) -> bool:
        """移除权限范围"""
        res = await self.session.execute(
            delete(ApiKeyScope).where(
                ApiKeyScope.id == scope_id, ApiKeyScope.api_key_id == api_key_id
            )
        )
        await self.session.flush()
        return res.rowcount > 0

    async def get_scopes(self, api_key_id: UUID) -> list[ApiKeyScope]:
        """获取权限范围列表"""
        stmt = select(ApiKeyScope).where(ApiKeyScope.api_key_id == api_key_id)
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # ============================================================
    # Rate Limit 操作
    # ============================================================

    async def get_rate_limit(self, api_key_id: UUID) -> ApiKeyRateLimit | None:
        """获取限流配置"""
        stmt = select(ApiKeyRateLimit).where(ApiKeyRateLimit.api_key_id == api_key_id)
        res = await self.session.execute(stmt)
        return res.scalars().first()

    async def update_rate_limit(
        self,
        api_key_id: UUID,
        data: dict,
    ) -> ApiKeyRateLimit:
        """更新限流配置（不存在则创建）"""
        obj = await self.get_rate_limit(api_key_id)
        if obj is None:
            obj = ApiKeyRateLimit(api_key_id=api_key_id)
            self.session.add(obj)
        for k, v in data.items():
            if hasattr(obj, k) and v is not None:
                setattr(obj, k, v)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    # ============================================================
    # Quota 操作
    # ============================================================

    async def get_quota(
        self,
        api_key_id: UUID,
        quota_type: QuotaType,
    ) -> ApiKeyQuota | None:
        """获取指定类型的配额"""
        stmt = select(ApiKeyQuota).where(
            ApiKeyQuota.api_key_id == api_key_id,
            ApiKeyQuota.quota_type == quota_type,
        )
        res = await self.session.execute(stmt)
        return res.scalars().first()

    async def add_quota(
        self,
        api_key_id: UUID,
        quota_type: QuotaType,
        total_quota: int,
        reset_period: str = "monthly",
    ) -> ApiKeyQuota:
        """添加配额"""
        obj = ApiKeyQuota(
            api_key_id=api_key_id,
            quota_type=quota_type,
            total_quota=total_quota,
            reset_period=reset_period,
            used_quota=0,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update_quota_usage(
        self,
        api_key_id: UUID,
        quota_type: QuotaType,
        delta: int,
    ) -> ApiKeyQuota | None:
        """更新配额使用量（原子操作）"""
        obj = await self.get_quota(api_key_id, quota_type)
        if not obj:
            return None
        obj.used_quota = max(0, obj.used_quota + delta)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def reset_quota(
        self,
        api_key_id: UUID,
        quota_type: QuotaType,
    ) -> ApiKeyQuota | None:
        """重置配额"""
        obj = await self.get_quota(api_key_id, quota_type)
        if not obj:
            return None
        obj.used_quota = 0
        obj.reset_at = datetime.utcnow()
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    # ============================================================
    # IP Whitelist 操作
    # ============================================================

    async def add_ip_whitelist(
        self,
        api_key_id: UUID,
        ip_pattern: str,
        description: str | None = None,
    ) -> ApiKeyIpWhitelist:
        """添加 IP 白名单"""
        obj = ApiKeyIpWhitelist(
            api_key_id=api_key_id,
            ip_pattern=ip_pattern,
            description=description,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def remove_ip_whitelist(self, api_key_id: UUID, ip_id: UUID) -> bool:
        """移除 IP 白名单"""
        res = await self.session.execute(
            delete(ApiKeyIpWhitelist).where(
                ApiKeyIpWhitelist.id == ip_id,
                ApiKeyIpWhitelist.api_key_id == api_key_id,
            )
        )
        await self.session.flush()
        return res.rowcount > 0

    async def get_ip_whitelist(self, api_key_id: UUID) -> list[ApiKeyIpWhitelist]:
        """获取 IP 白名单列表"""
        stmt = select(ApiKeyIpWhitelist).where(
            ApiKeyIpWhitelist.api_key_id == api_key_id
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # ============================================================
    # Usage 统计
    # ============================================================

    async def record_usage(
        self,
        api_key_id: UUID,
        request_count: int = 0,
        token_count: int = 0,
        cost: float = 0.0,
        error_count: int = 0,
    ) -> None:
        """记录使用量（按小时聚合，使用 UPSERT）"""
        now = datetime.utcnow()
        stat_date = now.date()
        stat_hour = now.hour
        stmt = insert(ApiKeyUsage).values(
            api_key_id=api_key_id,
            stat_date=stat_date,
            stat_hour=stat_hour,
            request_count=request_count,
            token_count=token_count,
            cost=cost,
            error_count=error_count,
        )
        update_stmt = {
            "request_count": ApiKeyUsage.request_count + request_count,
            "token_count": ApiKeyUsage.token_count + token_count,
            "cost": ApiKeyUsage.cost + cost,
            "error_count": ApiKeyUsage.error_count + error_count,
        }
        stmt = stmt.on_conflict_do_update(
            index_elements=["api_key_id", "stat_date", "stat_hour"],
            set_=update_stmt,
        )
        await self.session.execute(stmt)
        await self.session.flush()

    async def get_usage_stats(
        self,
        api_key_id: UUID,
        start_date: date,
        end_date: date,
    ) -> list[ApiKeyUsage]:
        """获取使用统计"""
        stmt = select(ApiKeyUsage).where(
            ApiKeyUsage.api_key_id == api_key_id,
            ApiKeyUsage.stat_date >= start_date,
            ApiKeyUsage.stat_date <= end_date,
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # ============================================================
    # 批量操作
    # ============================================================

    async def revoke_by_tenant(self, tenant_id: UUID, reason: str) -> int:
        """批量吊销租户的所有 Key（封禁联动）"""
        res = await self.session.execute(
            update(ApiKey)
            .where(ApiKey.tenant_id == tenant_id)
            .values(
                status=ApiKeyStatus.REVOKED,
                revoked_at=datetime.utcnow(),
                revoked_reason=reason,
            )
        )
        await self.session.flush()
        return res.rowcount or 0

    async def revoke_by_user(self, user_id: UUID, reason: str) -> int:
        """批量吊销用户的所有 Key"""
        res = await self.session.execute(
            update(ApiKey)
            .where(ApiKey.user_id == user_id)
            .values(
                status=ApiKeyStatus.REVOKED,
                revoked_at=datetime.utcnow(),
                revoked_reason=reason,
            )
        )
        await self.session.flush()
        return res.rowcount or 0

    async def expire_keys(self) -> int:
        """将已过期的 Key 状态更新为 expired（定时任务调用）"""
        now = datetime.utcnow()
        res = await self.session.execute(
            update(ApiKey)
            .where(ApiKey.expires_at.isnot(None))
            .where(ApiKey.expires_at < now)
            .where(ApiKey.status == ApiKeyStatus.ACTIVE)
            .values(status=ApiKeyStatus.EXPIRED)
        )
        await self.session.flush()
        return res.rowcount or 0
