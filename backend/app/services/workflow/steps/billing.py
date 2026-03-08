"""
BillingStep: 只记录流水，不扣减配额（P0-1 核心改动）

关键点：
- 流式：创建 PENDING 交易，流完成后提交（调用 BillingRepository.record_transaction）
- 非流式：默认记录流水（BillingRepository.record_transaction），QuotaCheck 未扣减时回退 BillingRepository.deduct
- 配额扣减通常在 QuotaCheckStep 完成，此处主要记录交易
- 如果实际费用与预估费用有差异，调整 Redis 余额差额
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import TYPE_CHECKING

from app.core.config import settings
from app.repositories.billing_repository import (
    BillingRepository,
    InsufficientBalanceError,
)
from app.services.billing_pipeline import calculate_cost as bp_calculate_cost
from app.services.billing_pipeline import estimate_cost as bp_estimate_cost
from app.services.billing_pipeline import record_and_adjust as bp_record_and_adjust
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import (
    BaseStep,
    StepConfig,
    StepResult,
    StepStatus,
)

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class BillingStep(BaseStep):
    """
    计费步骤（统一流式与非流式）
    """

    name = "billing"
    depends_on = ["response_transform"]

    def __init__(self, config: StepConfig | None = None):
        if config is None:
            config = StepConfig(timeout=10.0, max_retries=3)
        super().__init__(config)

    async def execute(self, ctx: WorkflowContext) -> StepResult:
        is_stream = ctx.get("upstream_call", "stream", False)
        if is_stream:
            return await self._create_pending_for_stream(ctx)
        return await self._deduct_for_non_stream(ctx)

    async def _create_pending_for_stream(self, ctx: WorkflowContext) -> StepResult:
        """
        流式：创建 PENDING 交易标记，不扣余额（P0-1）

        配额已在 QuotaCheckStep 扣减，此处只创建交易记录。
        """
        pricing = ctx.get("routing", "pricing_config") or {}
        if not pricing or not ctx.tenant_id:
            ctx.set("billing", "skip_reason", "no_pricing_or_tenant")
            return StepResult(status=StepStatus.SUCCESS)

        request = ctx.get("validation", "request")
        estimated_tokens = getattr(request, "max_tokens", 4096) if request else 4096

        try:
            repo = BillingRepository(ctx.db_session)
            tx = await repo.create_pending_transaction(
                tenant_id=ctx.tenant_id,
                trace_id=ctx.trace_id,
                estimated_tokens=estimated_tokens,
                pricing=pricing,
                api_key_id=ctx.api_key_id,
                provider=(
                    ctx.upstream_result.provider
                    if hasattr(ctx, "upstream_result")
                    else None
                ),
                model=ctx.requested_model,
                provider_model_id=ctx.get("routing", "provider_model_id"),
            )
            ctx.set("billing", "pending_transaction_id", str(tx.id))
            ctx.set("billing", "pending_trace_id", ctx.trace_id)
            ctx.set("billing", "pricing_config", pricing)
            return StepResult(
                status=StepStatus.SUCCESS, data={"pending_transaction_id": str(tx.id)}
            )
        except Exception as exc:
            logger.error(f"create_pending_failed trace_id={ctx.trace_id} err={exc}")
            return StepResult(
                status=StepStatus.FAILED, message="Create pending billing failed"
            )

    async def _deduct_for_non_stream(self, ctx: WorkflowContext) -> StepResult:
        """
        非流式：只记录流水，不扣减配额（P0-1）

        配额已在 QuotaCheckStep 扣减，此处只记录交易流水。
        如果实际费用与预估费用有差异，需要调整 Redis 余额。
        """
        pricing = ctx.get("routing", "pricing_config") or {}
        input_tokens = ctx.billing.input_tokens or 0
        output_tokens = ctx.billing.output_tokens or 0
        input_cost, output_cost, total_cost = bp_calculate_cost(
            input_tokens, output_tokens, pricing
        )
        currency = pricing.get("currency", "USD")

        ctx.billing.input_cost = input_cost
        ctx.billing.output_cost = output_cost
        ctx.billing.total_cost = total_cost
        ctx.billing.currency = currency
        ctx.set("billing", "total_cost", total_cost)
        self._sync_affinity_savings(ctx)

        if not pricing or not ctx.tenant_id:
            ctx.set("billing", "skip_reason", "no_pricing_or_tenant")
            await self._record_usage(
                ctx, total_cost, pricing, input_tokens, output_tokens
            )
            return StepResult(status=StepStatus.SUCCESS)

        if ctx.is_internal:
            await self._record_usage(
                ctx, total_cost, pricing, input_tokens, output_tokens
            )
            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_cost": total_cost,
                    "currency": currency,
                },
            )

        try:
            balance_after = await self._deduct_balance(
                ctx,
                total_cost,
                pricing,
                input_tokens,
                output_tokens,
            )
            if balance_after is None:
                await self._record_usage(
                    ctx, total_cost, pricing, input_tokens, output_tokens
                )
            else:
                ctx.set("billing", "balance_after", balance_after)
            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_cost": total_cost,
                    "currency": currency,
                },
            )
        except InsufficientBalanceError as exc:
            ctx.mark_error(ErrorSource.GATEWAY, "INSUFFICIENT_BALANCE", str(exc))
            return StepResult(
                status=StepStatus.FAILED,
                message="Payment required",
                data={
                    "error_code": "INSUFFICIENT_BALANCE",
                    "required": float(exc.required),
                    "available": float(exc.available),
                },
            )
        except Exception as exc:
            logger.error(f"billing_failed trace_id={ctx.trace_id} err={exc}")
            return StepResult(status=StepStatus.FAILED, message="billing failed")

    async def _deduct_balance(
        self,
        ctx: WorkflowContext,
        total_cost: float,
        pricing: dict,
        input_tokens: int,
        output_tokens: int,
    ) -> float | None:
        if not ctx.db_session or not ctx.tenant_id or total_cost <= 0:
            return None
        if (
            ctx.get("quota_check", "remaining_balance") is None
            and ctx.get("quota_check", "daily_remaining") is None
            and ctx.get("quota_check", "monthly_remaining") is None
        ):
            repo = BillingRepository(ctx.db_session)
            tx = await repo.deduct(
                tenant_id=ctx.tenant_id,
                amount=Decimal(str(total_cost)),
                trace_id=ctx.trace_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_price=Decimal(str(pricing.get("input_per_1k", 0))),
                output_price=Decimal(str(pricing.get("output_per_1k", 0))),
                provider=(
                    ctx.upstream_result.provider
                    if hasattr(ctx, "upstream_result")
                    else None
                ),
                model=ctx.requested_model,
                provider_model_id=ctx.get("routing", "provider_model_id"),
                api_key_id=ctx.api_key_id,
            )
            return float(tx.balance_after)
        return None

    async def _record_usage(
        self,
        ctx: WorkflowContext,
        total_cost: float,
        pricing: dict,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        if not ctx.db_session or not pricing or not ctx.tenant_id:
            return

        request = ctx.get("validation", "request")
        max_tokens = (getattr(request, "max_tokens", None) if request else None) or 4096
        estimated_cost = bp_estimate_cost(pricing, max_tokens)

        balance_after = await bp_record_and_adjust(
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
            provider_model_id=ctx.get("routing", "provider_model_id"),
            api_key_id=ctx.api_key_id,
        )
        if balance_after is not None:
            ctx.set("billing", "balance_after", balance_after)

    def _sync_affinity_savings(self, ctx: WorkflowContext) -> None:
        """
        在 billing 阶段补齐路由亲和节省估算。

        upstream_call 阶段时 token/cost 尚未回填，可能导致估算恒为 0。
        """
        affinity_hit = bool(ctx.get("routing", "affinity_hit", False))
        if not affinity_hit:
            return

        discount = max(0.0, min(1.0, float(settings.AFFINITY_ROUTING_DISCOUNT_RATE)))

        existing_tokens = ctx.get("routing", "affinity_saved_tokens_est", 0) or 0
        if (
            isinstance(existing_tokens, (int, float))
            and existing_tokens <= 0
            and ctx.billing.total_tokens > 0
        ):
            ctx.set(
                "routing",
                "affinity_saved_tokens_est",
                int(ctx.billing.total_tokens * discount),
            )

        existing_cost = ctx.get("routing", "affinity_saved_cost_est", 0.0) or 0.0
        if (
            isinstance(existing_cost, (int, float))
            and existing_cost <= 0
            and ctx.billing.total_cost > 0
        ):
            ctx.set(
                "routing",
                "affinity_saved_cost_est",
                float(ctx.billing.total_cost) * discount,
            )
