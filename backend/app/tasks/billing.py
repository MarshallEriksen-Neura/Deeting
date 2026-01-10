import uuid
from datetime import datetime, timezone
from typing import Any

import redis
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.db_sync import get_sync_db
from app.core.logging import logger
from app.models.api_key import ApiKeyQuota, ApiKeyUsage, QuotaType


@celery_app.task(name="app.tasks.billing.record_usage")
def record_usage_task(usage_data: dict[str, Any]) -> str:
    """
    异步记录 API Key 使用统计 (聚合到 ApiKeyUsage)
    同时更新 ApiKeyQuota (Token/Request) 和 Redis 缓存 (Token/Cost/Request)
    """
    api_key_id_str = usage_data.get("api_key_id")
    if not api_key_id_str:
        return "Skipped: No api_key_id"

    try:
        api_key_id = uuid.UUID(str(api_key_id_str))
    except ValueError:
        return f"Skipped: Invalid api_key_id {api_key_id_str}"

    db: Session = next(get_sync_db())
    try:
        now = datetime.now(timezone.utc)
        stat_date = now.date()
        stat_hour = now.hour

        # 准备增量数据
        input_tokens = usage_data.get("input_tokens", 0)
        output_tokens = usage_data.get("output_tokens", 0)
        total_tokens = input_tokens + output_tokens
        cost = usage_data.get("total_cost", 0)
        is_error = 1 if usage_data.get("is_error") else 0

        # 1. Postgres Upsert to ApiKeyUsage
        stmt = insert(ApiKeyUsage).values(
            api_key_id=api_key_id,
            stat_date=stat_date,
            stat_hour=stat_hour,
            request_count=1,
            token_count=total_tokens,
            cost=cost,
            error_count=is_error
        )

        do_update_stmt = stmt.on_conflict_do_update(
            constraint="uq_api_key_usage",
            set_={
                "request_count": ApiKeyUsage.request_count + 1,
                "token_count": ApiKeyUsage.token_count + stmt.excluded.token_count,
                "cost": ApiKeyUsage.cost + stmt.excluded.cost,
                "error_count": ApiKeyUsage.error_count + stmt.excluded.error_count,
            }
        )
        db.execute(do_update_stmt)

        # 2. Update ApiKeyQuota (DB)
        # Update Request Quota
        db.execute(
            update(ApiKeyQuota)
            .where(ApiKeyQuota.api_key_id == api_key_id)
            .where(ApiKeyQuota.quota_type == QuotaType.REQUEST)
            .values(used_quota = ApiKeyQuota.used_quota + 1)
        )

        # Update Token Quota (if tokens > 0)
        if total_tokens > 0:
            db.execute(
                update(ApiKeyQuota)
                .where(ApiKeyQuota.api_key_id == api_key_id)
                .where(ApiKeyQuota.quota_type == QuotaType.TOKEN)
                .values(used_quota = ApiKeyQuota.used_quota + total_tokens)
            )

        # Note: Cost quota in DB is skipped because used_quota is BigInt and cost is Decimal.
        # It relies on Redis or separate mechanism if persistence is needed for Cost Quota.

        db.commit()

        # 3. Update Redis Cache (Best Effort)
        try:
            if settings.REDIS_URL:
                # Use a sync redis client since we are in a sync task (or prefork worker)
                r = redis.from_url(settings.REDIS_URL, decode_responses=False)
                cache_key = f"{settings.CACHE_PREFIX}gw:quota:apikey:{api_key_id!s}"

                # Check if key exists (if not, QuotaCheckStep will warm it up next time,
                # so we don't need to create it here to avoid partial state)
                if r.exists(cache_key):
                    pipe = r.pipeline()
                    # Increment Token Used
                    if total_tokens > 0:
                        pipe.hincrby(cache_key, "token:used", total_tokens)

                    # Increment Cost Used
                    if cost > 0:
                        pipe.hincrbyfloat(cache_key, "cost:used", float(cost))

                    # Note: Request Used is usually incremented in QuotaCheckStep (pre-check),
                    # but if we want to be strictly consistent with post-billing, we could verify.
                    # However, QuotaCheckStep increments it *before* execution.
                    # Here we are *after* execution.
                    # If we increment again, we double count?
                    # QuotaCheckStep: checks and increments request count.
                    # BillingStep: records usage.
                    # So we should NOT increment request:used in Redis here,
                    # unless QuotaCheckStep failed to increment (e.g. didn't run).
                    # But QuotaCheckStep runs before.
                    # So we skip request:used increment in Redis here.

                    pipe.execute()
                    r.close()
        except Exception as re:
            logger.warning(f"Redis usage update failed: {re}")

        return f"Usage recorded for key {api_key_id}"
    except Exception as e:
        logger.error(f"Failed to record usage: {e}")
        db.rollback()
        raise e
    finally:
        db.close()
