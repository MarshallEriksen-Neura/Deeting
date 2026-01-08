import hashlib
import hmac
import time
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.models.api_key import ApiKeyType
from app.services.api_key import ApiKeyService, ApiPrincipal
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.signature_verify import SignatureError, SignatureVerifyStep
from app.core.cache import cache

class DummyRedis:
    def __init__(self):
        self.store = {}
        self.hash_store = {}

    async def set(self, key, value, ex=None, nx=None):
        if nx and key in self.store: return False
        self.store[key] = value
        return True

    async def get(self, key):
        return self.store.get(key)

    async def incr(self, key):
        val = int(self.store.get(key, 0)) + 1
        self.store[key] = str(val)
        return val

    async def expire(self, key, ttl): return True
    async def delete(self, *keys):
        for k in keys: self.store.pop(k, None)
        return True

def _sign(api_key: str, secret: str, timestamp: int, nonce: str) -> str:
    msg = f"{api_key}{timestamp}{nonce}"
    return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()

@pytest.fixture
def dummy_redis(monkeypatch):
    dummy = DummyRedis()
    monkeypatch.setattr(cache, "_redis", dummy)
    return dummy

@pytest.mark.asyncio
async def test_signature_requires_secret_when_configured():
    api_key = "sk-ext-abc"
    secret = "secret-xyz"
    ts = int(time.time())
    nonce = "n1"

    service = ApiKeyService(repository=AsyncMock(), redis_client=None, secret_key="jwt-secret")
    secret_hash = service._compute_key_hash(secret)
    principal = ApiPrincipal(
        api_key_id="ak-id",
        key_type=ApiKeyType.EXTERNAL,
        tenant_id="tenant-1",
        user_id=None,
        scopes=[],
        is_whitelist=False,
        rate_limit_rpm=None,
        rate_limit_tpm=None,
        secret_hash=secret_hash,
        secret_hint=secret[-4:],
    )

    step = SignatureVerifyStep(api_key_repo=AsyncMock())
    ctx = WorkflowContext(channel=Channel.EXTERNAL, tenant_id="tenant-1")
    ctx.client_ip = "1.1.1.1"

    with patch.object(ApiKeyService, "validate_key", AsyncMock(return_value=principal)), \
         patch.object(ApiKeyService, "_compute_key_hash", side_effect=service._compute_key_hash), \
         patch.object(ApiKeyService, "revoke_key", AsyncMock()), \
         patch.object(ApiKeyService, "check_ip", AsyncMock(return_value=True)):

        # 未提供 secret 应失败
        with pytest.raises(SignatureError, match="API secret required"):
            await step._verify_signature(ctx, api_key, ts, nonce, "bad", api_secret=None)

        # 提供正确 secret 应通过
        signature = _sign(api_key, secret, ts, nonce)
        result = await step._verify_signature(ctx, api_key, ts, nonce, signature, api_secret=secret)
        assert result["id"] == principal.api_key_id

@pytest.mark.asyncio
async def test_signature_continuous_failure_freeze(dummy_redis):
    api_key = "sk-ext-fail"
    ts = int(time.time())
    nonce = "n-fail"
    
    principal = ApiPrincipal(
        api_key_id="ak-fail",
        key_type=ApiKeyType.EXTERNAL,
        tenant_id="tenant-fail",
        user_id=None,
        scopes=[],
        is_whitelist=False,
        rate_limit_rpm=None,
        rate_limit_tpm=None,
        secret_hash=None,
    )

    step = SignatureVerifyStep(api_key_repo=AsyncMock())
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    
    with patch.object(ApiKeyService, "validate_key", AsyncMock(return_value=principal)), \
         patch.object(ApiKeyService, "revoke_key", AsyncMock()) as mock_revoke, \
         patch.object(ApiKeyService, "check_ip", AsyncMock(return_value=True)):
        
        # 模拟 4 次失败
        for i in range(1, 5):
            with pytest.raises(SignatureError, match=f"Signature mismatch (failures={i})"):
                await step._verify_signature(ctx, api_key, ts, nonce, "wrong-sig")
            assert mock_revoke.call_count == 0
            
        # 第 5 次失败触发冻结
        with pytest.raises(SignatureError, match="Signature mismatch, API key frozen"):
            await step._verify_signature(ctx, api_key, ts, nonce, "wrong-sig")
        
        mock_revoke.assert_called_once_with("ak-fail", "signature_failure_threshold")
        assert await dummy_redis.get(f"gw:blacklist:ak-fail") == "1"

@pytest.mark.asyncio
async def test_signature_success_resets_counter(dummy_redis):
    api_key = "sk-ext-reset"
    ts = int(time.time())
    
    principal = ApiPrincipal(
        api_key_id="ak-reset",
        key_type=ApiKeyType.EXTERNAL,
        tenant_id="tenant-reset",
        user_id=None,
        scopes=[],
        is_whitelist=False,
        rate_limit_rpm=None,
        rate_limit_tpm=None,
        secret_hash=None,
    )

    step = SignatureVerifyStep(api_key_repo=AsyncMock())
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    
    with patch.object(ApiKeyService, "validate_key", AsyncMock(return_value=principal)), \
         patch.object(ApiKeyService, "check_ip", AsyncMock(return_value=True)):
        # 1. 失败一次
        with pytest.raises(SignatureError):
            await step._verify_signature(ctx, api_key, ts, "n1", "wrong")
        
        fail_key = "gw:sig_fail:ak:ak-reset"
        assert await dummy_redis.get(fail_key) == "1"
        
        # 2. 成功一次，应重置
        correct_sig = _sign(api_key, api_key, ts, "n2") # No secret, fallback to api_key
        await step._verify_signature(ctx, api_key, ts, "n2", correct_sig)
        
        assert await dummy_redis.get(fail_key) is None