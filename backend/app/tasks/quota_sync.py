"""
配额周期性同步任务（Redis → DB）

用于审计和数据一致性保障：
- 定期将 Redis 中的配额数据同步回 DB
- 检测并修复 Redis 与 DB 的不一致
- 记录同步日志供审计
"""

from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.database import get_sync_session
from app.models.billing import TenantQuota
from app.utils.time_utils import Datetime

logger = logging.getLogger(__name__)


def sync_quota_from_redis_to_db(tenant_id: str) -> dict:
    """
    同步单个租户的配额从 Redis 到 DB
    
    Args:
        tenant_id: 租户 ID
        
    Returns:
        同步结果字典
    """
    redis_client = getattr(cache, "_redis", None)
    if not redis_client:
        return {"status": "skipped", "reason": "redis_unavailable"}

    try:
        # 从 Redis 读取配额
        key = CacheKeys.quota_hash(tenant_id)
        full_key = cache._make_key(key)
        
        # 使用同步 Redis 客户端
        import redis
        sync_redis = redis.from_url(cache._redis.connection_pool.connection_kwargs["url"])
        
        data = sync_redis.hgetall(full_key)
        if not data:
            return {"status": "skipped", "reason": "redis_key_not_found"}

        # 解析 Redis 数据
        redis_balance = Decimal(data.get(b"balance", b"0").decode())
        redis_daily_used = int(data.get(b"daily_used", 0))
        redis_monthly_used = int(data.get(b"monthly_used", 0))
        redis_version = int(data.get(b"version", 0))

        # 从 DB 读取配额
        with get_sync_session() as session:
            stmt = select(TenantQuota).where(TenantQuota.tenant_id == tenant_id)
            quota = session.execute(stmt).scalars().first()
            
            if not quota:
                logger.warning("sync_quota_db_not_found tenant=%s", tenant_id)
                return {"status": "failed", "reason": "db_record_not_found"}

            db_balance = quota.balance
            db_daily_used = quota.daily_used
            db_monthly_used = quota.monthly_used
            db_version = quota.version

            # 检查是否需要同步
            balance_diff = abs(float(redis_balance - db_balance))
            daily_diff = abs(redis_daily_used - db_daily_used)
            monthly_diff = abs(redis_monthly_used - db_monthly_used)

            if balance_diff < 0.000001 and daily_diff == 0 and monthly_diff == 0:
                return {
                    "status": "skipped",
                    "reason": "already_synced",
                    "redis_version": redis_version,
                    "db_version": db_version,
                }

            # 同步到 DB（Redis 为准）
            quota.balance = redis_balance
            quota.daily_used = redis_daily_used
            quota.monthly_used = redis_monthly_used
            quota.version = redis_version
            quota.updated_at = Datetime.utcnow()
            
            session.commit()

            logger.info(
                "sync_quota_success tenant=%s balance_diff=%s daily_diff=%d monthly_diff=%d",
                tenant_id,
                balance_diff,
                daily_diff,
                monthly_diff,
            )

            return {
                "status": "synced",
                "balance_diff": float(balance_diff),
                "daily_diff": daily_diff,
                "monthly_diff": monthly_diff,
                "redis_version": redis_version,
                "db_version": db_version,
            }

    except Exception as exc:
        logger.error("sync_quota_error tenant=%s err=%s", tenant_id, exc)
        return {"status": "failed", "reason": str(exc)}


def sync_all_quotas() -> dict:
    """
    同步所有租户的配额
    
    Returns:
        同步汇总结果
    """
    try:
        with get_sync_session() as session:
            stmt = select(TenantQuota.tenant_id)
            tenant_ids = session.execute(stmt).scalars().all()

        results = {
            "total": len(tenant_ids),
            "synced": 0,
            "skipped": 0,
            "failed": 0,
            "details": [],
        }

        for tenant_id in tenant_ids:
            result = sync_quota_from_redis_to_db(str(tenant_id))
            
            if result["status"] == "synced":
                results["synced"] += 1
            elif result["status"] == "skipped":
                results["skipped"] += 1
            else:
                results["failed"] += 1
            
            results["details"].append({
                "tenant_id": str(tenant_id),
                **result,
            })

        logger.info(
            "sync_all_quotas_complete total=%d synced=%d skipped=%d failed=%d",
            results["total"],
            results["synced"],
            results["skipped"],
            results["failed"],
        )

        return results

    except Exception as exc:
        logger.error("sync_all_quotas_error err=%s", exc)
        return {
            "status": "failed",
            "reason": str(exc),
        }


# Celery 任务（如果使用 Celery）
try:
    from app.core.celery_app import celery_app

    @celery_app.task(name="quota_sync.sync_quota_from_redis")
    def sync_quota_task(tenant_id: str) -> dict:
        """Celery 任务：同步单个租户配额"""
        return sync_quota_from_redis_to_db(tenant_id)

    @celery_app.task(name="quota_sync.sync_all_quotas")
    def sync_all_quotas_task() -> dict:
        """Celery 任务：同步所有租户配额"""
        return sync_all_quotas()

except ImportError:
    logger.info("Celery not available, quota sync tasks will not be registered")
