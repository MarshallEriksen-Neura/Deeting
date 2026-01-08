"""
BillingStep: 计费步骤

职责：
- 外部通道：严格计费、余额扣减、用量记账，余额不足返回 402
- 内部通道：以审计/告警为主，可选成本核算
"""

import logging
from decimal import Decimal
from typing import TYPE_CHECKING

from app.core.config import settings
from app.repositories.billing_repository import BillingRepository, InsufficientBalanceError
from app.repositories.usage_repository import UsageRepository
from app.services.orchestrator.context import ErrorSource
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepConfig, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class BillingStep(BaseStep):
    """
    计费步骤

    从上下文读取:
        - ctx.billing: BillingInfo (input_tokens, output_tokens)
        - ctx.tenant_id: 租户 ID
        - routing.pricing_config: 定价配置

    写入上下文:
        - billing.cost: 本次费用
        - billing.balance_after: 扣费后余额

    同时更新 ctx.billing.total_cost
    """

    name = "billing"
    depends_on = ["response_transform"]

    def __init__(self, config: StepConfig | None = None):
        if config is None:
            config = StepConfig(
                timeout=10.0,
                max_retries=3,  # 计费重试
            )
        super().__init__(config)
        self.billing_repo: BillingRepository | None = None
        self.usage_repo: UsageRepository | None = None

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行计费"""
        # 获取 token 用量
        input_tokens = ctx.billing.input_tokens
        output_tokens = ctx.billing.output_tokens

        # 获取定价配置
        pricing = await self._get_pricing(ctx)

        # 若未配置定价，则视为免费（记录用量但不扣费）
        if not pricing:
            input_cost = output_cost = total_cost = 0.0
            currency = ctx.billing.currency or "USD"
        else:
            # 计算费用
            input_cost = self._calculate_cost(input_tokens, pricing.get("input_per_1k", 0))
            output_cost = self._calculate_cost(output_tokens, pricing.get("output_per_1k", 0))
            total_cost = input_cost + output_cost
            currency = pricing.get("currency", "USD")

        # 更新 billing 信息
        ctx.billing.input_cost = input_cost
        ctx.billing.output_cost = output_cost
        ctx.billing.total_cost = total_cost
        ctx.billing.currency = currency

        ctx.set("billing", "input_cost", input_cost)
        ctx.set("billing", "output_cost", output_cost)
        ctx.set("billing", "total_cost", total_cost)

        # 外部通道：扣减余额
        if pricing and ctx.is_external and ctx.tenant_id:
            try:
                balance_after = await self._deduct_balance(ctx, total_cost, pricing)
                ctx.set("billing", "balance_after", balance_after)
            except InsufficientBalanceError as e:
                logger.error(f"Insufficient balance: tenant={ctx.tenant_id} required={e.required} available={e.available}")
                ctx.set("billing", "error", str(e))

                # 外部通道余额不足应阻塞请求（可配置）
                if getattr(settings, "BILLING_BLOCK_ON_INSUFFICIENT", True):
                    ctx.mark_error(
                        ErrorSource.GATEWAY,
                        "INSUFFICIENT_BALANCE",
                        f"Insufficient balance: required={e.required}, available={e.available}",
                    )
                    return StepResult(
                        status=StepStatus.FAILED,
                        message="Payment required: insufficient balance",
                        data={
                            "error_code": "INSUFFICIENT_BALANCE",
                            "http_status": 402,
                            "required": float(e.required),
                            "available": float(e.available),
                        },
                    )

        # 记录用量
        await self._record_usage(ctx)

        logger.info(
            f"Billing completed trace_id={ctx.trace_id} "
            f"tenant={ctx.tenant_id} "
            f"tokens={ctx.billing.total_tokens} "
            f"cost={total_cost:.6f} {ctx.billing.currency}"
        )

        return StepResult(
            status=StepStatus.SUCCESS,
            data={
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_cost": total_cost,
                "currency": ctx.billing.currency,
            },
        )

    async def _get_pricing(self, ctx: "WorkflowContext") -> dict:
        """
        获取定价配置：仅使用 routing.pricing_config；未配置则返回空 dict。
        """
        pricing = ctx.get("routing", "pricing_config") or {}
        return pricing

    def _calculate_cost(self, tokens: int, price_per_1k: float) -> float:
        """计算费用（精确计算）"""
        if tokens <= 0 or price_per_1k <= 0:
            return 0.0

        # 使用 Decimal 避免浮点精度问题
        tokens_dec = Decimal(str(tokens))
        price_dec = Decimal(str(price_per_1k))
        cost = (tokens_dec / 1000) * price_dec

        return float(cost.quantize(Decimal("0.000001")))

    async def _deduct_balance(
        self,
        ctx: "WorkflowContext",
        total_cost: float,
        pricing: dict,
    ) -> float:
        """
        扣减余额（使用新的 BillingRepository）

        流程：
        1. 使用数据库事务保证原子性
        2. 记录交易流水（幂等键防重）
        3. 更新租户配额
        """
        repo = self.billing_repo or BillingRepository(ctx.db_session)

        transaction = await repo.deduct(
            tenant_id=ctx.tenant_id,
            amount=Decimal(str(total_cost)),
            trace_id=ctx.trace_id,
            input_tokens=ctx.billing.input_tokens,
            output_tokens=ctx.billing.output_tokens,
            input_price=Decimal(str(pricing.get("input_per_1k", 0))),
            output_price=Decimal(str(pricing.get("output_per_1k", 0))),
            provider=ctx.upstream_result.provider,
            model=ctx.requested_model,
            preset_item_id=ctx.get("routing", "preset_item_id"),
            api_key_id=ctx.api_key_id,
            allow_negative=False,
        )

        return float(transaction.balance_after)

    async def _record_usage(self, ctx: "WorkflowContext") -> None:
        try:
            from app.tasks.billing import record_usage_task

            usage_data = {
                "tenant_id": str(ctx.tenant_id) if ctx.tenant_id else None,
                "api_key_id": str(ctx.api_key_id) if ctx.api_key_id else None,
                "trace_id": ctx.trace_id,
                "model": ctx.requested_model,
                "capability": ctx.capability,
                "input_tokens": ctx.billing.input_tokens,
                "output_tokens": ctx.billing.output_tokens,
                "total_cost": ctx.billing.total_cost,
                "currency": ctx.billing.currency,
                "provider": ctx.upstream_result.provider,
                "latency_ms": ctx.upstream_result.latency_ms,
                "is_error": not ctx.is_success,
            }

            record_usage_task.delay(usage_data)
        except Exception as exc:
            logger.warning(f"Usage task dispatch failed: {exc}")
