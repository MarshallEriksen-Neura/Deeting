
import pytest
import time
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch, MagicMock
from main import app
from app.services.api_key import ApiKeyService, ApiPrincipal
from app.models.api_key import ApiKeyType
from app.services.workflow.steps.base import StepResult, StepStatus
from app.core.cache import cache

@pytest.mark.asyncio
async def test_rate_limit_integration(monkeypatch):
    from uuid import uuid4
    api_key = "sk-rl-test"
    api_key_id = uuid4()
    tenant_id = uuid4()
    
    principal = ApiPrincipal(
        api_key_id=api_key_id,
        key_type=ApiKeyType.EXTERNAL,
        tenant_id=tenant_id,
        user_id=None,
        scopes=[],
        is_whitelist=False,
        rate_limit_rpm=2, # 2 requests per minute
        rate_limit_tpm=100,
    )
    
    monkeypatch.setattr(ApiKeyService, "validate_key", AsyncMock(return_value=principal))
    monkeypatch.setattr(ApiKeyService, "check_ip", AsyncMock(return_value=True))
    # 使用内存 fallback，避免 DummyRedis 脚本分支绕过限流逻辑
    monkeypatch.setattr(cache, "_redis", None)
    
    # Bypass signature verification
    with patch("app.services.workflow.steps.signature_verify.SignatureVerifyStep._verify_signature", 
               AsyncMock(return_value={"id": api_key_id, "tenant_id": "tenant-rl", "rate_limit_rpm": 2, "rate_limit_tpm": 100})):
        
        # Mock upstream call
        async def mock_upstream(ctx):
            ctx.set("upstream_call", "response", {"id": "mock", "choices": []})
            ctx.set("upstream_call", "status_code", 200)
            ctx.set("sanitize", "response", {"id": "mock"})
            ctx.upstream_result = MagicMock(status_code=200, error_code=None)
            return StepResult(status=StepStatus.SUCCESS, data={"response": {"id": "mock"}})

        with patch("app.services.workflow.steps.upstream_call.UpstreamCallStep.execute", side_effect=mock_upstream):
            
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                headers = {"X-Api-Key": api_key, "X-Timestamp": str(int(time.time())), "X-Signature": "fake"}
                
                # Request 1: OK
                resp1 = await ac.post("/external/v1/chat/completions", json={
                    "model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "hi"}]
                }, headers=headers)
                assert resp1.status_code == 200
                
                # Request 2: OK
                resp2 = await ac.post("/external/v1/chat/completions", json={
                    "model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "hi"}]
                }, headers=headers)
                assert resp2.status_code == 200
                
                # Request 3: Rate Limited
                resp3 = await ac.post("/external/v1/chat/completions", json={
                    "model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "hi"}]
                }, headers=headers)
                assert resp3.status_code == 429
                assert "Too Many Requests" in resp3.text
