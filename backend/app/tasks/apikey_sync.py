"""
API Key 预算周期性同步任务（Redis → DB）

用于同步 API Key 的 budget_used 字段：
- 定期将 Redis 中的 budget_used 同步回 DB
- 检测并修复不一致
- 记录同步日志供审计
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.database import get_sync_session
from app.models.api_key import ApiKey

logger = logging.getLogger(__name__)


def sync_apikey_budget_from_redis_to_db(api_key_id: str) -> dict:
    """
    同步单个 API Key 的预算从 Redis 到 DB
    
    Args:
        api_key_id: API Key ID
        
    Returns:
        同步结果字典
    """
    redis_client = getattr(cache, "_redis", None)
    if not redis_client:
        return {"status": "skipped", "reason": "redis_unavailable"}

    try:
        # 从 Redis 读取预算
        key = CacheKeys.apikey_budget_hash(api_key_id)
        full_key = cache._make_key(key)
        
        # 使用同步 Redis 客户端
        import redis
        sync_redis = redis.from_url(cache._redis.connection_pool.connection_kwargs["url"])
        
        data = sync_redis.hgetall(full_key)
        if not data:
            return {"status": "skipped", "reason": "redis_key_not_found"}

        # 解析 Redis 数据
        redis_budget_used = Decimal(data.get(b"budget_used", b"0").decode())
        redis_version = int(data.get(b"version", 0))

        # 从 DB 读取 API Key
        with get_sync_session() as session:
            stmt = select(ApiKey).where(ApiKey.id == api_key_id)
            api_key = session.execute(stmt).scalars().first()
            
            if not api_key:
                logger.warning("sync_apikey_budget_db_not_found api_key=%s", api_key_id)
                return {"status": "failed", "reason": "db_record_not_found"}

            db_budget_used = api_key.budget_used or Decimal("0")

            # 检查是否需要同步
            budget_diff = abs(float(redis_budget_used - db_budget_used))

            if budget_diff < 0.000001:
                return {
                    "status": "skipped",
                    "reason": "already_synced",
                    "redis_version": redis_version,
                }

            # 同步到 DB（Redis 为准）
            stmt = (
                update(ApiKey)
                .where(ApiKey.id == api_key_id)
                .values(
                    budget_used=redis_budget_used,
                    updated_at=datetime.utcnow(),
                )
            )
            session.execute(stmt)
            session.commit()

            logger.info(
                "sync_apikey_budget_success api_key=%s budget_diff=%s",
                api_key_id,
                budget_diff,
            )

            return {
                "status": "synced",
                "budget_diff": float(budget_diff),
                "redis_version": redis_version,
            }

    except Exception as exc:
        logger.error("sync_apikey_budget_error api_key=%s err=%s", api_key_id, exc)
        return {"status": "failed", "reason": str(exc)}


def sync_all_apikey_budgets() -> dict:
    """
    同步所有 API Key 的预算
    
    Returns:
        同步汇总结果
    """
    try:
        with get_sync_session() as session:
            # 只同步有预算限制的 API Key
            stmt = select(ApiKey.id).where(ApiKey.budget_limit.isnot(None))
            api_key_ids = session.execute(stmt).scalars().all()

        results = {
            "total": len(api_key_ids),
            "synced": 0,
            "skipped": 0,
            "failed": 0,
            "details": [],
        }

        for api_key_id in api_key_ids:
            result = sync_apikey_budget_from_redis_to_db(str(api_key_id))
            
            if result["status"] == "synced":
                results["synced"] += 1
            elif result["status"] == "skipped":
                results["skipped"] += 1
            else:
                results["failed"] += 1
            
            results["details"].append({
                "api_key_id": str(api_key_id),
                **result,
            })

        logger.info(
            "sync_all_apikey_budgets_complete total=%d synced=%d skipped=%d failed=%d",
            results["total"],
            results["synced"],
            results["skipped"],
            results["failed"],
        )

        return results

    except Exception as exc:
        logger.error("sync_all_apikey_budgets_error err=%s", exc)
        return {
            "status": "failed",
            "reason": str(exc),
        }


# Celery 任务（如果使用 Celery）
try:
    from app.core.celery_app import celery_app

    @celery_app.task(name="apikey_sync.sync_apikey_budget_from_redis")
    def sync_apikey_budget_task(api_key_id: str) -> dict:
        """Celery 任务：同步单个 API Key 预算"""
        return sync_apikey_budget_from_redis_to_db(api_key_id)

    @celery_app.task(name="apikey_sync.sync_all_apikey_budgets")
    def sync_all_apikey_budgets_task() -> dict:
        """Celery 任务：同步所有 API Key 预算"""
        return sync_all_apikey_budgets()

except ImportError:
    logger.info("Celery not available, apikey sync tasks will not be registered")
