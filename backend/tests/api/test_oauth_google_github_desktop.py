import urllib.parse
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.models import Base, DesktopOAuthGrant, DesktopOAuthSession, User
from app.schemas.auth import TokenPair
from app.services.users import desktop_oauth_service as oauth_desktop_svc
from main import app


def _enable_google(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_ENABLED", True)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "google-client")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "google-secret")
    monkeypatch.setattr(settings, "GOOGLE_REDIRECT_URI", "https://api.example.com/api/v1/auth/oauth/google/callback")
    monkeypatch.setattr(settings, "DESKTOP_OAUTH_CALLBACK_SCHEME", "deeting")


def _enable_github(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_OAUTH_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "github-client")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "github-secret")
    monkeypatch.setattr(settings, "GITHUB_REDIRECT_URI", "https://api.example.com/api/v1/auth/oauth/github/callback")
    monkeypatch.setattr(settings, "DESKTOP_OAUTH_CALLBACK_SCHEME", "deeting")


@pytest.mark.asyncio
async def test_desktop_start_returns_authorize_url(client: AsyncClient, monkeypatch):
    _enable_google(monkeypatch)

    response = await client.post(
        "/api/v1/auth/oauth/desktop/start",
        json={"provider": "google", "return_scheme": "deeting", "platform": "desktop"},
    )
    assert response.status_code == 200
    data = response.json()
    assert UUID(data["session_id"])
    assert "accounts.google.com" in data["authorize_url"]
    assert data["expires_in"] == settings.DESKTOP_OAUTH_SESSION_TTL_SECONDS


@pytest.mark.asyncio
async def test_desktop_oauth_callback_and_exchange(monkeypatch, client: AsyncClient, AsyncSessionLocal):
    _enable_google(monkeypatch)
    from app.core.database import get_db

    prev_overrides = app.dependency_overrides.copy()

    async def _override_get_db():
        async with AsyncSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        async with AsyncSessionLocal() as session:
            async with session.bind.begin() as conn:  # type: ignore[union-attr]
                await conn.run_sync(Base.metadata.create_all)

        async def fake_exchange(cfg, client, *, code, code_verifier):
            return oauth_desktop_svc.ProviderToken(access_token="google-access-token")

        async def fake_profile(cfg, client, access_token):
            return oauth_desktop_svc.ProviderUserProfile(
                external_id="google-user-1",
                email="desktop@example.com",
                username="desktop@example.com",
                display_name="Desktop User",
                avatar_url="https://example.com/avatar.png",
            )

        monkeypatch.setattr(oauth_desktop_svc, "_exchange_provider_code", fake_exchange)
        monkeypatch.setattr(oauth_desktop_svc, "_fetch_provider_profile", fake_profile)

        async def fake_create_tokens(self, user):
            return TokenPair(access_token="desktop-access-token", refresh_token="desktop-refresh-token", token_type="bearer"), "refresh-jti-1"

        monkeypatch.setattr(oauth_desktop_svc.AuthService, "create_tokens", fake_create_tokens)

        start = await client.post(
            "/api/v1/auth/oauth/desktop/start",
            json={"provider": "google", "return_scheme": "deeting", "platform": "desktop"},
        )
        assert start.status_code == 200
        start_data = start.json()
        session_id = start_data["session_id"]
        parsed = urllib.parse.urlparse(start_data["authorize_url"])
        qs = urllib.parse.parse_qs(parsed.query)
        state = qs["state"][0]

        callback = await client.get(
            f"/api/v1/auth/oauth/google/callback?code=test-code&state={state}",
            follow_redirects=False,
        )
        assert callback.status_code == 307
        redirect = callback.headers["location"]
        assert redirect.startswith("deeting://auth/callback?")
        redirect_qs = urllib.parse.parse_qs(urllib.parse.urlparse(redirect).query)
        assert redirect_qs["session_id"][0] == session_id
        grant = redirect_qs["grant"][0]

        exchange = await client.post(
            "/api/v1/auth/oauth/desktop/exchange",
            json={
                "provider": "google",
                "session_id": session_id,
                "state": state,
                "grant": grant,
            },
        )
        assert exchange.status_code == 200
        payload = exchange.json()
        assert payload["access_token"]
        assert payload["token_type"] == "bearer"
        assert payload["user"]["email"] == "desktop@example.com"

        replay = await client.post(
            "/api/v1/auth/oauth/desktop/exchange",
            json={
                "provider": "google",
                "session_id": session_id,
                "state": state,
                "grant": grant,
            },
        )
        assert replay.status_code == 400

        async with AsyncSessionLocal() as session:
            user = await session.scalar(select(User).where(User.email == "desktop@example.com"))
            assert user is not None
            oauth_session = await session.get(DesktopOAuthSession, UUID(session_id))
            assert oauth_session is not None
            assert oauth_session.status == oauth_desktop_svc.SESSION_STATUS_EXCHANGED
            grant_row = await session.scalar(select(DesktopOAuthGrant).where(DesktopOAuthGrant.session_id == oauth_session.id))
            assert grant_row is not None
            assert grant_row.status == oauth_desktop_svc.GRANT_STATUS_CONSUMED
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev_overrides)


@pytest.mark.asyncio
async def test_desktop_start_rejects_unknown_provider(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/oauth/desktop/start",
        json={"provider": "unknown", "return_scheme": "deeting", "platform": "desktop"},
    )
    assert response.status_code == 404
