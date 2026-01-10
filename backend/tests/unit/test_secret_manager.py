from unittest.mock import AsyncMock

import pytest

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.services.secrets.manager import SecretManager


@pytest.mark.asyncio
async def test_get_falls_back_to_env(monkeypatch):
    manager = SecretManager()
    monkeypatch.setenv("UPSTREAM_OPENAI_SECRET", "env-secret")

    secret = await manager.get("openai", None)

    assert secret == "env-secret"


@pytest.mark.asyncio
async def test_get_uses_cache(monkeypatch):
    manager = SecretManager()
    fake_cache = AsyncMock()
    fake_cache.get = AsyncMock(return_value="cached")
    monkeypatch.setattr(cache, "get", fake_cache.get)
    monkeypatch.setattr(cache, "set", AsyncMock())

    secret = await manager.get("openai", "ref-1")

    assert secret == "cached"
    fake_cache.get.assert_called_once_with(CacheKeys.upstream_credential("openai", "ref-1"))


@pytest.mark.asyncio
async def test_rotate_sets_cache_and_invalidates(monkeypatch):
    manager = SecretManager()

    set_mock = AsyncMock()
    monkeypatch.setattr(cache, "set", set_mock)

    invalidator_mock = AsyncMock()
    monkeypatch.setattr(manager, "_invalidator", invalidator_mock)

    result = await manager.rotate("openai", "ref-1", "new-secret")

    assert result is True
    set_mock.assert_called_once_with(CacheKeys.upstream_credential("openai", "ref-1"), "new-secret", ttl=300)
    invalidator_mock.on_secret_rotated.assert_awaited_with("openai")
