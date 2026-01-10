
import pytest
import time
from decimal import Decimal
from uuid import uuid4
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch, MagicMock
from main import app
from app.services.api_key import ApiKeyService, ApiPrincipal
from app.models.api_key import ApiKeyType
from app.repositories.billing_repository import BillingRepository, InsufficientBalanceError
from app.services.workflow.steps.base import StepResult, StepStatus

@pytest.mark.asyncio
async def test_billing_integration_insufficient_balance(monkeypatch):
    api_key = "sk-bill-test"
    api_key_id = uuid4()
    tenant_id = uuid4()
    
    principal = ApiPrincipal(
        api_key_id=api_key_id,
        key_type=ApiKeyType.EXTERNAL,
        tenant_id=tenant_id,
        user_id=None,
        scopes=[],
        is_whitelist=False,
        rate_limit_rpm=100,
        rate_limit_tpm=1000,
    )
    
    monkeypatch.setattr(ApiKeyService, "validate_key", AsyncMock(return_value=principal))
    monkeypatch.setattr(ApiKeyService, "check_ip", AsyncMock(return_value=True))
    
    with patch(
        "app.services.workflow.steps.signature_verify.SignatureVerifyStep._verify_signature",
        AsyncMock(return_value={"id": api_key_id, "tenant_id": tenant_id}),
    ):
        # Mock upstream call to return a response with usage
        mock_response = {
            "id": "chatcmpl-123",
            "usage": {"prompt_tokens": 1000000, "completion_tokens": 0, "total_tokens": 1000000},
        }

        with patch("app.services.workflow.steps.upstream_call.UpstreamCallStep.execute") as mock_upstream:
            async def mock_execute(ctx):
                ctx.billing.input_tokens = 1000000
                ctx.billing.output_tokens = 0
                ctx.set("upstream_call", "response", mock_response)
                ctx.set("upstream_call", "status_code", 200)
                ctx.set("routing", "provider", "openai")
                ctx.set("routing", "pricing_config", {"input_per_1k": 0.03, "output_per_1k": 0, "currency": "USD"})
                ctx.set("sanitize", "response", mock_response)
                ctx.upstream_result = MagicMock(provider="openai", status_code=200, error_code=None)
                return StepResult(status=StepStatus.SUCCESS, data={"response": mock_response})

            mock_upstream.side_effect = mock_execute

            # Mock BillingRepository.deduct to raise InsufficientBalanceError
            with patch(
                "app.repositories.billing_repository.BillingRepository.deduct",
                AsyncMock(side_effect=InsufficientBalanceError(Decimal("30.0"), Decimal("0.5"))),
            ):
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                    headers = {"X-Api-Key": api_key, "X-Timestamp": str(int(time.time())), "X-Signature": "fake"}
                    response = await ac.post(
                        "/external/v1/chat/completions",
                        json={
                            "model": "gpt-4",
                            "messages": [{"role": "user", "content": "expensive request"}],
                        },
                        headers=headers,
                    )

                assert response.status_code == 402
                assert "Insufficient balance" in response.text
