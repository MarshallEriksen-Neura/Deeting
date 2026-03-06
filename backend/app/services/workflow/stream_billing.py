"""
流式响应计费回调。

为内部网关/助手预览等流式场景提供统一的计费与用量落库逻辑。
"""

import logging
from typing import Any

from app.core.cache import cache
from app.repositories.usage_repository import UsageRepository
from app.services.billing_pipeline import calculate_cost as bp_calculate_cost
from app.services.billing_pipeline import estimate_cost as bp_estimate_cost
from app.services.billing_pipeline import record_and_adjust as bp_record_and_adjust
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

    input_cost, output_cost, total_cost = bp_calculate_cost(
        input_tokens, output_tokens, pricing
    )

    ctx.billing.input_cost = input_cost
    ctx.billing.output_cost = output_cost
    ctx.billing.total_cost = total_cost
    ctx.billing.currency = (
        pricing.get("currency", "USD") if pricing else ctx.billing.currency or "USD"
    )

    if pricing and ctx.tenant_id and ctx.db_session:
        try:
            request = ctx.get("validation", "request")
            max_tokens = getattr(request, "max_tokens", 4096) if request else 4096
            estimated_cost = bp_estimate_cost(pricing, max_tokens)

            await bp_record_and_adjust(
                db_session=ctx.db_session,
                tenant_id=str(ctx.tenant_id),
                trace_id=ctx.trace_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                pricing_config=pricing,
                estimated_cost=estimated_cost,
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


def _record_usage_task(**kwargs: Any) -> None:
    """用量记录任务（同步执行）。"""
    try:
        usage_repo = UsageRepository()
        import asyncio

        asyncio.run(usage_repo.create(kwargs))
    except Exception as exc:
        logger.error("Usage record failed trace_id=%s: %s", kwargs.get("trace_id"), exc)
