"""
BillingStep: 只记录流水，不扣减配额（P0-1 核心改动）

关键点：
- 流式：创建 PENDING 交易，流完成后提交（调用 BillingRepository.record_transaction）
- 非流式：直接记录流水（调用 BillingRepository.record_transaction）
- 配额扣减已在 QuotaCheckStep 完成，此处只记录交易
- 如果实际费用与预估费用有差异，调整 Redis 余额差额
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import TYPE_CHECKING

from app.repositories.billing_repository import BillingRepository
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepConfig, StepResult, StepStatus

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

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        is_stream = ctx.get("upstream_call", "stream", False)
        if is_stream:
            return await self._create_pending_for_stream(ctx)
        return await self._deduct_for_non_stream(ctx)

    async def _create_pending_for_stream(self, ctx: "WorkflowContext") -> StepResult:
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
                provider=ctx.upstream_result.provider if hasattr(ctx, "upstream_result") else None,
                model=ctx.requested_model,
                preset_item_id=ctx.get("routing", "provider_model_id"),
            )
            ctx.set("billing", "pending_transaction_id", str(tx.id))
            ctx.set("billing", "pending_trace_id", ctx.trace_id)
            ctx.set("billing", "pricing_config", pricing)
            return StepResult(status=StepStatus.SUCCESS, data={"pending_transaction_id": str(tx.id)})
        except Exception as exc:  # noqa: PERF203
            logger.error(f"create_pending_failed trace_id={ctx.trace_id} err={exc}")
            return StepResult(status=StepStatus.FAILED, message="Create pending billing failed")

    async def _deduct_for_non_stream(self, ctx: "WorkflowContext") -> StepResult:
        """
        非流式：只记录流水，不扣减配额（P0-1）
        
        配额已在 QuotaCheckStep 扣减，此处只记录交易流水。
        如果实际费用与预估费用有差异，需要调整 Redis 余额。
        """
        pricing = ctx.get("routing", "pricing_config") or {}
        if not pricing or not ctx.tenant_id:
            ctx.set("billing", "skip_reason", "no_pricing_or_tenant")
            return StepResult(status=StepStatus.SUCCESS)

        input_tokens = ctx.billing.input_tokens
        output_tokens = ctx.billing.output_tokens
        input_cost = self._calculate_cost(input_tokens, pricing.get("input_per_1k", 0))
        output_cost = self._calculate_cost(output_tokens, pricing.get("output_per_1k", 0))
        total_cost = input_cost + output_cost
        currency = pricing.get("currency", "USD")

        ctx.billing.input_cost = input_cost
        ctx.billing.output_cost = output_cost
        ctx.billing.total_cost = total_cost
        ctx.billing.currency = currency
        ctx.set("billing", "total_cost", total_cost)

        try:
            repo = BillingRepository(ctx.db_session)
            
            # 获取 QuotaCheckStep 中扣减的预估费用
            estimated_cost = await self._get_estimated_cost(ctx)
            cost_diff = Decimal(str(total_cost)) - Decimal(str(estimated_cost))
            
            # 记录交易流水（不扣减配额）
            tx = await repo.record_transaction(
                tenant_id=ctx.tenant_id,
                amount=Decimal(str(total_cost)),
                trace_id=ctx.trace_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_price=Decimal(str(pricing.get("input_per_1k", 0))),
                output_price=Decimal(str(pricing.get("output_per_1k", 0))),
                provider=ctx.upstream_result.provider if hasattr(ctx, "upstream_result") else None,
                model=ctx.requested_model,
                preset_item_id=ctx.get("routing", "provider_model_id"),
                api_key_id=ctx.api_key_id,
            )
            
            # 如果实际费用与预估费用有差异，调整 Redis 余额
            if abs(float(cost_diff)) > 0.000001:
                await repo.adjust_redis_balance(ctx.tenant_id, cost_diff)
                logger.debug(
                    "billing_cost_adjusted tenant=%s estimated=%s actual=%s diff=%s",
                    ctx.tenant_id,
                    estimated_cost,
                    total_cost,
                    cost_diff,
                )
            
            ctx.set("billing", "balance_after", float(tx.balance_after))
            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_cost": total_cost,
                    "currency": currency,
                },
            )
        except Exception as exc:  # noqa: PERF203
            logger.error(f"billing_failed trace_id={ctx.trace_id} err={exc}")
            return StepResult(status=StepStatus.FAILED, message="billing failed")

    async def _get_estimated_cost(self, ctx: "WorkflowContext") -> float:
        """获取 QuotaCheckStep 中使用的预估费用"""
        pricing = ctx.get("routing", "pricing_config") or {}
        if not pricing:
            return 0.0

        request = ctx.get("validation", "request")
        max_tokens = getattr(request, "max_tokens", 4096) if request else 4096
        estimated_tokens = max_tokens * 2  # 输入+输出粗估

        avg_price = (
            float(pricing.get("input_per_1k", 0)) +
            float(pricing.get("output_per_1k", 0))
        ) / 2
        return (estimated_tokens / 1000) * avg_price

    def _calculate_cost(self, tokens: int, price_per_1k: float) -> float:
        if tokens <= 0 or price_per_1k <= 0:
            return 0.0
        tokens_dec = Decimal(str(tokens))
        price_dec = Decimal(str(price_per_1k))
        cost = (tokens_dec / 1000) * price_dec
        return float(cost.quantize(Decimal("0.000001")))
