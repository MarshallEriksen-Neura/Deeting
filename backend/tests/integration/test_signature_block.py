
import hashlib
import hmac
import time
import pytest
from httpx import ASGITransport, AsyncClient
from app.core.cache import cache
from app.core.cache_keys import CacheKeys

def _sign(api_key: str, secret: str, timestamp: int, nonce: str) -> str:
    msg = f"{api_key}{timestamp}{nonce}"
    return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()

@pytest.mark.asyncio
async def test_continuous_signature_failure_blocks_key(monkeypatch):
    # This integration test assumes a running app or uses a mock client with real orchestrator
    # For simplicity in this environment, we will use a more targeted integration test 
    # that exercises the Orchestrator with a mock Upstream
    
    from main import app
    from app.services.providers.api_key import ApiKeyService, ApiPrincipal
    from app.models.api_key import ApiKeyType
    
    api_key = "sk-block-test"
    from uuid import uuid4
    api_key_id = uuid4()
    tenant_id = uuid4()
    
    # Mock ApiKeyService to return our test key
    principal = ApiPrincipal(
        api_key_id=api_key_id,
        key_type=ApiKeyType.EXTERNAL,
        tenant_id=tenant_id,
        user_id=None,
        scopes=[],
        is_whitelist=False,
        rate_limit_rpm=100,
        rate_limit_tpm=1000,
        secret_hash=None,
        secret_hint=None,
    )
    
    async def mock_validate_key(key):
        if key == api_key:
            # Check if it's blacklisted in Redis
            if await cache.get(CacheKeys.api_key_blacklist(api_key_id)):
                return None
            return principal
        return None

    monkeypatch.setattr(ApiKeyService, "validate_key", mock_validate_key)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. 连续 5 次错误签名
        for i in range(5):
            ts = int(time.time())
            headers = {
                "X-Api-Key": api_key,
                "X-Signature": "wrong-sig",
                "X-Timestamp": str(ts),
                "X-Nonce": f"nonce-{i}",
            }
            response = await ac.post(
                "/external/v1/chat/completions",
                json={"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "hi"}]},
                headers=headers,
            )

            assert response.status_code == 401
            assert "Signature mismatch" in response.text

        # 2. 第 6 次，即使签名正确也应被拒绝 (因为已被冻结)
        ts = int(time.time())
        nonce = "nonce-final"
        correct_sig = _sign(api_key, api_key, ts, nonce)
        headers = {
            "X-Api-Key": api_key,
            "X-Signature": correct_sig,
            "X-Timestamp": str(ts),
            "X-Nonce": nonce,
        }
        response = await ac.post(
            "/external/v1/chat/completions",
            json={"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "hi"}]},
            headers=headers,
        )

        # Depending on how it fails, it might be 401 or another code
        assert response.status_code == 401
        assert "Invalid or inactive API key" in response.text

    # Cleanup
    await cache.delete(CacheKeys.api_key_blacklist(api_key_id))
    await cache.delete(CacheKeys.api_key_revoked(api_key_id))
    await cache.delete(CacheKeys.signature_fail_api_key(api_key_id))
