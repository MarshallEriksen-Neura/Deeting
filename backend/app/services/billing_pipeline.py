"""
BillingPipeline: 共享计费服务层

Gateway steps (QuotaCheckStep / BillingStep / stream_billing_callback) 和
Credits Proxy (/credits/chat/completions) 统一调用此模块，确保两条路径的
预扣、费用计算、流水记录、Redis 差额调整行为完全一致。
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING, AsyncIterator

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.repositories.billing_repository import BillingRepository
from app.repositories.quota_repository import InsufficientQuotaError, QuotaRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class QuotaExceededError(Exception):
    """配额超限异常（从 quota_check.py 统一到此处）"""

    def __init__(self, quota_type: str, required: float, available: float):
        self.quota_type = quota_type
        self.required = required
        self.available = available
        super().__init__(
            f"{quota_type} quota insufficient: required={required}, available={available}"
        )


# ---------------------------------------------------------------------------
# Pure helpers (no I/O)
# ---------------------------------------------------------------------------


def estimate_cost(pricing_config: dict, max_tokens: int = 4096) -> float:
    """估算费用，用于预扣。与 QuotaCheckStep._estimate_cost 保持一致。"""
    if not pricing_config:
        return 0.0
    estimated_tokens = max_tokens * 2
    avg_price = (
        float(pricing_config.get("input_per_1k", 0))
        + float(pricing_config.get("output_per_1k", 0))
    ) / 2
    return (estimated_tokens / 1000) * avg_price


def calculate_cost(
    input_tokens: int,
    output_tokens: int,
    pricing_config: dict,
) -> tuple[float, float, float]:
    """
    计算实际费用。返回 (input_cost, output_cost, total_cost)。
    与 BillingStep._calculate_cost 保持一致的 Decimal 精度。
    """
    input_per_1k = pricing_config.get("input_per_1k", 0)
    output_per_1k = pricing_config.get("output_per_1k", 0)

    def _cost(tokens: int, price_per_1k: float) -> float:
        if not tokens or not price_per_1k or tokens <= 0 or price_per_1k <= 0:
            return 0.0
        return float(
            ((Decimal(str(tokens)) / 1000) * Decimal(str(price_per_1k))).quantize(
                Decimal("0.000001")
            )
        )

    ic = _cost(input_tokens, input_per_1k)
    oc = _cost(output_tokens, output_per_1k)
    return ic, oc, ic + oc


# ---------------------------------------------------------------------------
# Quota pre-check (Redis Lua → DB fallback)
# ---------------------------------------------------------------------------

_DATE_HELPERS_LOADED = False


def _today_str() -> str:
    from datetime import date
    return date.today().isoformat()


def _month_str() -> str:
    from datetime import date
    d = date.today()
    return f"{d.year:04d}-{d.month:02d}"


async def quota_precheck(
    tenant_id: str,
    estimated_cost: float,
    db_session: AsyncSession,
    quota_repo: QuotaRepository | None = None,
) -> dict:
    """
    Redis Lua 原子预扣配额。余额不足时抛 QuotaExceededError。

    复用自 QuotaCheckStep._check_quota_redis + _deduct_quota_db。
    """
    redis_client = getattr(cache, "_redis", None)
    if not redis_client:
        return await _deduct_quota_db(tenant_id, estimated_cost, db_session, quota_repo)

    script_sha = cache.get_script_sha("quota_deduct")
    if not script_sha:
        await cache.preload_scripts()
        script_sha = cache.get_script_sha("quota_deduct")

    if not script_sha:
        logger.warning("quota_deduct_script_not_found, fallback to DB")
        return await _deduct_quota_db(tenant_id, estimated_cost, db_session, quota_repo)

    key = CacheKeys.quota_hash(tenant_id)
    full_key = cache._make_key(key)
    exists = await redis_client.exists(full_key)
    if not exists:
        await _warm_quota_cache(redis_client, full_key, tenant_id, db_session, quota_repo)

    result = await redis_client.evalsha(
        script_sha,
        1,
        full_key,
        str(estimated_cost),
        "1",
        "1",
        _today_str(),
        _month_str(),
        "0",
    )

    if result[0] == 0:
        err = result[1]
        if err == "INSUFFICIENT_BALANCE":
            raise QuotaExceededError("balance", float(result[2]), float(result[3]))
        if err == "DAILY_QUOTA_EXCEEDED":
            raise QuotaExceededError("daily", float(result[2]), float(result[3]))
        if err == "MONTHLY_QUOTA_EXCEEDED":
            raise QuotaExceededError("monthly", float(result[2]), float(result[3]))
        raise QuotaExceededError("unknown", 0, 0)

    return {
        "balance": float(result[2]),
        "daily_used": int(result[3]),
        "monthly_used": int(result[4]),
        "version": int(result[5]),
        "daily_remaining": None,
        "monthly_remaining": None,
    }


async def _warm_quota_cache(
    redis_client,
    full_key: str,
    tenant_id: str,
    db_session: AsyncSession,
    quota_repo: QuotaRepository | None,
) -> None:
    lock_key = f"{full_key}:warming"
    acquired = await redis_client.set(lock_key, "1", ex=5, nx=True)
    if not acquired:
        await asyncio.sleep(0.05)
        if await redis_client.exists(full_key):
            return
        await asyncio.sleep(0.05)
        return

    try:
        repo = quota_repo or QuotaRepository(db_session)
        quota = await repo.get_or_create(tenant_id)
        payload = {
            "balance": str(quota.balance),
            "credit_limit": str(quota.credit_limit),
            "daily_quota": str(quota.daily_quota),
            "daily_used": str(quota.daily_used),
            "daily_date": (
                quota.daily_reset_at.isoformat()
                if quota.daily_reset_at
                else _today_str()
            ),
            "monthly_quota": str(quota.monthly_quota),
            "monthly_used": str(quota.monthly_used),
            "monthly_month": (
                quota.monthly_reset_at.strftime("%Y-%m")
                if quota.monthly_reset_at
                else _month_str()
            ),
            "rpm_limit": str(quota.rpm_limit) if quota.rpm_limit else "0",
            "tpm_limit": str(quota.tpm_limit) if quota.tpm_limit else "0",
            "version": str(quota.version),
        }
        await redis_client.hset(full_key, mapping=payload)
        await redis_client.expire(full_key, 86400)
        logger.debug("billing_pipeline_quota_cache_warmed tenant=%s", tenant_id)
    finally:
        await redis_client.delete(lock_key)


async def _deduct_quota_db(
    tenant_id: str,
    estimated_cost: float,
    db_session: AsyncSession,
    quota_repo: QuotaRepository | None,
) -> dict:
    repo = quota_repo or QuotaRepository(db_session)
    try:
        quota = await repo.check_and_deduct(
            tenant_id=tenant_id,
            balance_amount=Decimal(str(estimated_cost)),
            daily_requests=1,
            monthly_requests=1,
            allow_negative=False,
            commit=False,
            sync_cache=False,
            invalidate_cache=False,
        )
        return {
            "balance": float(quota.balance),
            "credit_limit": float(quota.credit_limit),
            "daily_remaining": int(quota.daily_quota - quota.daily_used),
            "monthly_remaining": int(quota.monthly_quota - quota.monthly_used),
            "daily_used": int(quota.daily_used),
            "monthly_used": int(quota.monthly_used),
            "version": int(quota.version),
        }
    except InsufficientQuotaError as e:
        raise QuotaExceededError(e.quota_type, e.required, e.available) from e


# ---------------------------------------------------------------------------
# Transaction recording + Redis balance adjustment
# ---------------------------------------------------------------------------


async def record_and_adjust(
    db_session: AsyncSession,
    tenant_id: str,
    trace_id: str,
    input_tokens: int,
    output_tokens: int,
    pricing_config: dict,
    estimated_cost: float,
    *,
    provider: str | None = None,
    model: str | None = None,
    preset_item_id: str | None = None,
    api_key_id: str | None = None,
    description: str | None = None,
) -> float | None:
    """
    记录计费流水并调整 Redis 预扣差额。
    返回 balance_after 或 None。
    """
    if not tenant_id or not pricing_config:
        return None

    input_cost, output_cost, total_cost = calculate_cost(
        input_tokens, output_tokens, pricing_config
    )
    if total_cost <= 0:
        return None

    input_per_1k = Decimal(str(pricing_config.get("input_per_1k", 0)))
    output_per_1k = Decimal(str(pricing_config.get("output_per_1k", 0)))
    cost_diff = Decimal(str(total_cost)) - Decimal(str(estimated_cost))

    repo = BillingRepository(db_session)
    tx = await repo.record_transaction(
        tenant_id=tenant_id,
        amount=Decimal(str(total_cost)),
        trace_id=trace_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        input_price=input_per_1k,
        output_price=output_per_1k,
        provider=provider,
        model=model,
        preset_item_id=preset_item_id,
        api_key_id=api_key_id,
        description=description,
    )

    if abs(float(cost_diff)) > 0.000001:
        await repo.adjust_redis_balance(tenant_id, cost_diff)
        logger.debug(
            "billing_pipeline_cost_adjusted tenant=%s estimated=%s actual=%s diff=%s",
            tenant_id, estimated_cost, total_cost, cost_diff,
        )

    return float(tx.balance_after)


# ---------------------------------------------------------------------------
# SSE stream billing wrapper (for Credits Proxy)
# ---------------------------------------------------------------------------


@dataclass
class StreamUsageAccumulator:
    """
    轻量 SSE usage 提取器，复用 StreamTokenAccumulator 的解析逻辑。
    仅关注 usage tokens，不追踪 assistant content / tool calls。
    """

    input_tokens: int = 0
    output_tokens: int = 0
    is_completed: bool = False
    error: str | None = None
    _chunks: int = 0

    def feed(self, chunk: bytes) -> None:
        import json as _json

        try:
            text = chunk.decode("utf-8")
        except Exception:
            return

        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            if line == "data: [DONE]":
                self.is_completed = True
                continue
            if not line.startswith("data: "):
                continue
            try:
                data = _json.loads(line[6:])
                self._chunks += 1
                if "usage" in data:
                    usage = data["usage"]
                    self.input_tokens = usage.get("prompt_tokens", 0)
                    self.output_tokens = usage.get("completion_tokens", 0)
            except Exception:
                pass


async def wrap_stream_with_billing(
    raw_stream: AsyncIterator[bytes],
    db_session: AsyncSession,
    tenant_id: str,
    trace_id: str,
    pricing_config: dict,
    estimated_cost: float,
    *,
    provider: str | None = None,
    model: str | None = None,
) -> AsyncIterator[bytes]:
    """
    包装 httpx SSE 流：透传字节 + 提取 usage + 流结束后扣费。
    供 Credits Proxy 的 streaming 路径使用。
    """
    acc = StreamUsageAccumulator()
    try:
        async for chunk in raw_stream:
            acc.feed(chunk)
            yield chunk
    except Exception as exc:
        acc.error = str(exc)
        raise
    finally:
        try:
            await record_and_adjust(
                db_session=db_session,
                tenant_id=tenant_id,
                trace_id=trace_id,
                input_tokens=acc.input_tokens,
                output_tokens=acc.output_tokens,
                pricing_config=pricing_config,
                estimated_cost=estimated_cost,
                provider=provider,
                model=model,
                description="Credits proxy stream billing",
            )
            await db_session.commit()
        except Exception as exc:
            logger.error(
                "stream_billing_failed tenant=%s trace=%s err=%s",
                tenant_id, trace_id, exc,
            )
            await db_session.rollback()
