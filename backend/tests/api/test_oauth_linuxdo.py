import urllib.parse
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.core.cache import cache
from app.core.config import settings
from app.models import Identity, User
from app.services.users import oauth_linuxdo_service as oauth_svc
from tests.api.conftest import AsyncSessionLocal
from sqlalchemy import select


def _enable_linuxdo(monkeypatch):
    monkeypatch.setattr(settings, "LINUXDO_OAUTH_ENABLED", True)
    monkeypatch.setattr(settings, "LINUXDO_CLIENT_ID", "dummy-client")
    monkeypatch.setattr(settings, "LINUXDO_CLIENT_SECRET", "dummy-secret")
    monkeypatch.setattr(settings, "LINUXDO_REDIRECT_URI", "https://example.com/callback")


@pytest.mark.asyncio
async def test_authorize_redirect_and_state_stored(client: AsyncClient, monkeypatch):
    _enable_linuxdo(monkeypatch)

    resp = await client.get("/api/v1/auth/oauth/linuxdo/authorize")
    assert resp.status_code == 307
    location = resp.headers.get("location", "")
    assert settings.LINUXDO_AUTHORIZE_ENDPOINT in location

    # 提取 state 并验证已存入缓存
    parsed = urllib.parse.urlparse(location)
    qs = urllib.parse.parse_qs(parsed.query)
    state = qs.get("state", [None])[0]
    assert state

    cached = await cache.get(f"auth:oauth:linuxdo:state:{state}")
    assert cached is not None and cached.get("provider") == "linuxdo"


@pytest.mark.asyncio
async def test_callback_creates_user_and_identity(monkeypatch, client: AsyncClient):
    _enable_linuxdo(monkeypatch)

    state = "test-state-123"
    await cache.set(f"auth:oauth:linuxdo:state:{state}", {"provider": "linuxdo"}, ttl=300)

    async def fake_exchange(client, code):
        return oauth_svc.LinuxDoToken("atk", "Bearer", 3600)

    async def fake_profile(client, token):
        return oauth_svc.LinuxDoUserProfile(
            external_id="ext-uid-1",
            username="linuxdo_user",
            display_name="LinuxDo User",
            avatar_url="https://example.com/avatar.png",
            is_active=True,
        )

    monkeypatch.setattr(oauth_svc, "_exchange_code", fake_exchange)
    monkeypatch.setattr(oauth_svc, "_fetch_profile", fake_profile)

    resp = await client.post(
        "/api/v1/auth/oauth/callback",
        json={"code": "dummy-code", "state": state},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["access_token"]
    assert data["refresh_token"]
    user_id = UUID(data["user_id"])

    # 校验用户与 Identity 已写入
    async with AsyncSessionLocal() as session:
        user = await session.get(User, user_id)
        assert user is not None
        res = await session.execute(select(Identity).where(Identity.user_id == user_id))
        identity = res.scalar_one_or_none()
        assert identity is not None
        assert identity.external_id == "ext-uid-1"

    # state 应被消费删除
    assert await cache.get(f"auth:oauth:linuxdo:state:{state}") is None


@pytest.mark.asyncio
async def test_callback_invalid_state(monkeypatch, client: AsyncClient):
    _enable_linuxdo(monkeypatch)
    # 未预置 state，应该 400
    resp = await client.post(
        "/api/v1/auth/oauth/callback",
        json={"code": "dummy-code", "state": "missing"},
    )
    assert resp.status_code == 400
    assert "state" in resp.json()["detail"]
