"""
流式响应计费回调。

为内部网关/助手预览等流式场景提供统一的计费与用量落库逻辑。
"""

import logging
from decimal import Decimal
from typing import Any

from app.core.cache import cache
from app.repositories.billing_repository import BillingRepository
from app.repositories.usage_repository import UsageRepository
from app.services.orchestrator.context import WorkflowContext
from app.services.workflow.steps.upstream_call import StreamTokenAccumulator

logger = logging.getLogger(__name__)


async def stream_billing_callback(
    ctx: WorkflowContext,
    accumulator: StreamTokenAccumulator,
) -> None:
    """
    流式计费回调：在流完成后记录流水并调整预扣差额。
    """
    pricing = ctx.get("routing", "pricing_config") or {}

    input_tokens = ctx.billing.input_tokens
    output_tokens = ctx.billing.output_tokens

    input_per_1k = (
        Decimal(str(pricing.get("input_per_1k", 0))) if pricing else Decimal("0")
    )
    output_per_1k = (
        Decimal(str(pricing.get("output_per_1k", 0))) if pricing else Decimal("0")
    )

    input_cost = (
        float((Decimal(input_tokens) / 1000) * input_per_1k) if pricing else 0.0
    )
    output_cost = (
        float((Decimal(output_tokens) / 1000) * output_per_1k) if pricing else 0.0
    )
    total_cost = input_cost + output_cost

    ctx.billing.input_cost = input_cost
    ctx.billing.output_cost = output_cost
    ctx.billing.total_cost = total_cost
    ctx.billing.currency = (
        pricing.get("currency", "USD") if pricing else ctx.billing.currency or "USD"
    )

    if pricing and ctx.tenant_id and ctx.db_session:
        try:
            repo = BillingRepository(ctx.db_session)
            estimated_cost = await _get_estimated_cost_for_stream(ctx)
            cost_diff = Decimal(str(total_cost)) - Decimal(str(estimated_cost))

            await repo.record_transaction(
                tenant_id=ctx.tenant_id,
                amount=Decimal(str(total_cost)),
                trace_id=ctx.trace_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_price=input_per_1k,
                output_price=output_per_1k,
                provider=(
                    ctx.upstream_result.provider
                    if hasattr(ctx, "upstream_result")
                    else None
                ),
                model=ctx.requested_model,
                preset_item_id=ctx.get("routing", "preset_item_id"),
                api_key_id=ctx.api_key_id,
                description="Stream billing completed",
            )

            if abs(float(cost_diff)) > 0.000001:
                await repo.adjust_redis_balance(ctx.tenant_id, cost_diff)
                logger.debug(
                    "stream_billing_cost_adjusted tenant=%s estimated=%s actual=%s diff=%s",
                    ctx.tenant_id,
                    estimated_cost,
                    total_cost,
                    cost_diff,
                )

            await ctx.db_session.commit()
        except Exception as exc:
            logger.error("Stream billing failed trace_id=%s: %s", ctx.trace_id, exc)
            await ctx.db_session.rollback()
        else:
            if ctx.api_key_id and total_cost > 0:
                try:
                    from app.core.transaction_celery import get_transaction_scheduler
                    from app.tasks.apikey_sync import sync_apikey_budget_task

                    redis_client = getattr(cache, "_redis", None)
                    if redis_client:
                        from app.core.cache_keys import CacheKeys

                        key = CacheKeys.apikey_budget_hash(str(ctx.api_key_id))
                        full_key = cache._make_key(key)
                        await redis_client.hincrby(
                            full_key, "budget_used", int(total_cost * 1000000)
                        )
                        await redis_client.hincrby(full_key, "version", 1)

                    scheduler = get_transaction_scheduler(ctx.db_session)
                    scheduler.delay_after_commit(
                        sync_apikey_budget_task,
                        str(ctx.api_key_id),
                    )

                    current_budget_used = float(
                        ctx.get("external_auth", "budget_used") or 0.0
                    )
                    ctx.set(
                        "external_auth", "budget_used", current_budget_used + total_cost
                    )
                except Exception as exc:
                    logger.warning(
                        "Stream budget_used update failed trace_id=%s: %s",
                        ctx.trace_id,
                        exc,
                    )

    if ctx.db_session:
        try:
            from app.core.transaction_celery import get_transaction_scheduler

            scheduler = get_transaction_scheduler(ctx.db_session)
            scheduler.apply_async_after_commit(
                _record_usage_task,
                kwargs={
                    "tenant_id": str(ctx.tenant_id) if ctx.tenant_id else None,
                    "api_key_id": str(ctx.api_key_id) if ctx.api_key_id else None,
                    "trace_id": ctx.trace_id,
                    "model": ctx.requested_model,
                    "capability": ctx.capability,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_cost": total_cost,
                    "currency": ctx.billing.currency,
                    "provider": (
                        ctx.upstream_result.provider
                        if hasattr(ctx, "upstream_result")
                        else None
                    ),
                    "latency_ms": (
                        ctx.upstream_result.latency_ms
                        if hasattr(ctx, "upstream_result")
                        else None
                    ),
                    "is_stream": True,
                    "stream_completed": accumulator.is_completed,
                    "stream_error": accumulator.error,
                },
            )
        except Exception as exc:
            logger.error(
                "Stream usage schedule failed trace_id=%s: %s",
                ctx.trace_id,
                exc,
            )

    logger.info(
        "Stream billing completed trace_id=%s tenant=%s tokens=%s cost=%.6f %s completed=%s",
        ctx.trace_id,
        ctx.tenant_id,
        ctx.billing.total_tokens,
        total_cost,
        ctx.billing.currency,
        accumulator.is_completed,
    )


async def _get_estimated_cost_for_stream(ctx: WorkflowContext) -> float:
    """获取流式请求的预估费用（与 QuotaCheckStep 计算方式保持一致）。"""
    pricing = ctx.get("routing", "pricing_config") or {}
    if not pricing:
        return 0.0

    request = ctx.get("validation", "request")
    max_tokens = getattr(request, "max_tokens", 4096) if request else 4096
    estimated_tokens = max_tokens * 2
    avg_price = (
        float(pricing.get("input_per_1k", 0)) + float(pricing.get("output_per_1k", 0))
    ) / 2
    return (estimated_tokens / 1000) * avg_price


def _record_usage_task(**kwargs: Any) -> None:
    """用量记录任务（同步执行）。"""
    try:
        usage_repo = UsageRepository()
        import asyncio

        asyncio.run(usage_repo.create(kwargs))
    except Exception as exc:
        logger.error("Usage record failed trace_id=%s: %s", kwargs.get("trace_id"), exc)
