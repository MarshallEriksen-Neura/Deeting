
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from app.services.orchestrator.context import WorkflowContext, Channel, BillingInfo, UpstreamResult
from app.services.workflow.steps.billing import BillingStep
from app.services.workflow.steps.base import StepStatus
from app.repositories.billing_repository import InsufficientBalanceError

@pytest.mark.asyncio
async def test_billing_calculation():
    step = BillingStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    ctx.billing = BillingInfo(input_tokens=1000, output_tokens=2000)
    ctx.requested_model = "gpt-4"
    ctx.set("routing", "pricing_config", {"input_per_1k": 0.03, "output_per_1k": 0.06, "currency": "USD"})

    # 定价: input=0.03, output=0.06
    # 1000 * 0.03 / 1000 = 0.03
    # 2000 * 0.06 / 1000 = 0.12
    # total = 0.15

    with patch.object(BillingStep, "_deduct_balance", AsyncMock(return_value=10.0)), \
         patch.object(BillingStep, "_record_usage", AsyncMock()):
        
        result = await step.execute(ctx)
        
        assert result.status == StepStatus.SUCCESS
        assert ctx.billing.input_cost == 0.03
        assert ctx.billing.output_cost == 0.12
        assert ctx.billing.total_cost == 0.15
        assert ctx.get("billing", "total_cost") == 0.15

@pytest.mark.asyncio
async def test_billing_insufficient_balance():
    step = BillingStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL, tenant_id="t-1")
    ctx.billing = BillingInfo(input_tokens=1000, output_tokens=1000)
    ctx.requested_model = "gpt-4"
    ctx.set("routing", "pricing_config", {"input_per_1k": 0.03, "output_per_1k": 0.06})
    
    # 模拟余额不足
    error = InsufficientBalanceError(Decimal("0.09"), Decimal("0.05"))
    
    with patch.object(BillingStep, "_deduct_balance", AsyncMock(side_effect=error)):
        result = await step.execute(ctx)
        
        assert result.status == StepStatus.FAILED
        assert "Payment required" in result.message
        assert result.data["error_code"] == "INSUFFICIENT_BALANCE"
        assert result.data["required"] == 0.09
        assert result.data["available"] == 0.05
        assert ctx.error_code == "INSUFFICIENT_BALANCE"


@pytest.mark.asyncio
async def test_billing_internal_channel_no_deduct():
    step = BillingStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL, tenant_id="t-1")
    ctx.billing = BillingInfo(input_tokens=100, output_tokens=100)
    ctx.set("routing", "pricing_config", {"input_per_1k": 0.02, "output_per_1k": 0.04})
    
    with patch.object(BillingStep, "_deduct_balance", AsyncMock()) as mock_deduct, \
         patch.object(BillingStep, "_record_usage", AsyncMock()):
        
        result = await step.execute(ctx)
        assert result.status == StepStatus.SUCCESS
        # 内部通道不应调用扣费
        mock_deduct.assert_not_called()


@pytest.mark.asyncio
async def test_billing_without_pricing_is_free():
    step = BillingStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL, tenant_id="t-1")
    ctx.billing = BillingInfo(input_tokens=500, output_tokens=800)
    
    with patch.object(BillingStep, "_deduct_balance", AsyncMock()) as mock_deduct, \
         patch.object(BillingStep, "_record_usage", AsyncMock()) as mock_usage:
        
        result = await step.execute(ctx)
        assert result.status == StepStatus.SUCCESS
        assert ctx.billing.total_cost == 0.0
        assert ctx.billing.input_cost == 0.0
        assert ctx.billing.output_cost == 0.0
        mock_deduct.assert_not_called()
        mock_usage.assert_called_once()
