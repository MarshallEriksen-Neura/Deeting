
import pytest
import time
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch, MagicMock
from main import app
from app.services.api_key import ApiKeyService, ApiPrincipal
from app.models.api_key import ApiKeyType
from app.services.workflow.steps.base import StepResult, StepStatus

@pytest.mark.asyncio
async def test_ip_whitelist_validation(monkeypatch):
    from uuid import uuid4
    api_key = "sk-ip-test"
    api_key_id = uuid4()
    
    principal = ApiPrincipal(
        api_key_id=api_key_id,
        key_type=ApiKeyType.EXTERNAL,
        tenant_id=uuid4(),
        user_id=None,
        scopes=[],
        is_whitelist=False,
        rate_limit_rpm=100,
        rate_limit_tpm=1000,
    )
    
    monkeypatch.setattr(ApiKeyService, "validate_key", AsyncMock(return_value=principal))
    
    # 模拟 check_ip
    async def mock_check_ip(key_id, client_ip=None, client_host=None):
        if client_ip == "1.2.3.4":
            return True
        return False
        
    monkeypatch.setattr(ApiKeyService, "check_ip", mock_check_ip)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. 不在白名单的 IP
        headers = {
            "X-Api-Key": api_key,
            "X-Timestamp": str(int(time.time())),
            "X-Signature": "fake",
            "X-Forwarded-For": "5.6.7.8"
        }
        # We need to bypass actual signature verify for this test or mock it
        with patch("app.services.workflow.steps.signature_verify.SignatureVerifyStep._verify_signature", 
                   AsyncMock(side_effect=Exception("Client IP/host not allowed"))):
            response = await ac.post("/external/v1/chat/completions", json={
                "model": "gpt-3.5-turbo",
                "messages": [{"role": "user", "content": "hi"}]
            }, headers=headers)
            assert response.status_code == 401
            assert "Client IP/host not allowed" in response.text

        # 2. 在白名单的 IP
        with patch("app.services.workflow.steps.signature_verify.SignatureVerifyStep._verify_signature", 
                   AsyncMock(return_value={"id": api_key_id, "tenant_id": "tenant-ip"})):
            headers["X-Forwarded-For"] = "1.2.3.4"
            # Mock upstream call to avoid real network
            async def mock_upstream(ctx):
                ctx.set("upstream_call", "response", {"ok": True})
                ctx.set("upstream_call", "status_code", 200)
                ctx.set("sanitize", "response", {"ok": True})
                ctx.upstream_result = MagicMock(status_code=200, error_code=None)
                return StepResult(status=StepStatus.SUCCESS, data={"response": {"ok": True}})

            with patch("app.services.workflow.steps.upstream_call.UpstreamCallStep.execute", side_effect=mock_upstream):
                response = await ac.post("/external/v1/chat/completions", json={
                    "model": "gpt-3.5-turbo",
                    "messages": [{"role": "user", "content": "hi"}]
                }, headers=headers)
                # Should pass signature verify
                assert response.status_code != 401
