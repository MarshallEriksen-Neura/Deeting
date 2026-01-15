import urllib.parse
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.models import Identity, User, Base
from app.services.users import oauth_linuxdo_service as oauth_svc
from sqlalchemy import select
from main import app


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

    cached = await cache.get(CacheKeys.oauth_linuxdo_state(state))
    assert cached is not None and cached.get("provider") == "linuxdo"


@pytest.mark.asyncio
async def test_callback_creates_user_and_identity(monkeypatch, client: AsyncClient, AsyncSessionLocal):
    _enable_linuxdo(monkeypatch)
    from app.core.database import get_db
    # 显式覆盖依赖，确保路由使用内存 SQLite
    prev_overrides = app.dependency_overrides.copy()
    async def _override_get_db():
        async with AsyncSessionLocal() as session:
            yield session
    app.dependency_overrides[get_db] = _override_get_db
    try:
        # 确保测试内的内存数据库具备模型表
        async with AsyncSessionLocal() as session:
            async with session.bind.begin() as conn:  # type: ignore[union-attr]
                await conn.run_sync(Base.metadata.create_all)

        state = "test-state-123"
        await cache.set(CacheKeys.oauth_linuxdo_state(state), {"provider": "linuxdo"}, ttl=300)

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
        assert await cache.get(CacheKeys.oauth_linuxdo_state(state)) is None
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev_overrides)


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
