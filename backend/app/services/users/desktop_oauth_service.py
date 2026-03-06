from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, timedelta
from typing import Any
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import DesktopOAuthGrant, DesktopOAuthSession, User
from app.repositories import UserRepository
from app.services.users.auth_service import AuthService
from app.services.users.user_provisioning_service import UserProvisioningService
from app.utils.time_utils import Datetime

SESSION_STATUS_CREATED = "created"
SESSION_STATUS_CALLBACK_RECEIVED = "callback_received"
SESSION_STATUS_GRANT_ISSUED = "grant_issued"
SESSION_STATUS_EXCHANGED = "exchanged"
SESSION_STATUS_EXPIRED = "expired"
GRANT_STATUS_ACTIVE = "active"
GRANT_STATUS_CONSUMED = "consumed"
GRANT_STATUS_EXPIRED = "expired"


class DesktopOAuthError(HTTPException):
    def __init__(self, detail: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(status_code=status_code, detail=detail)


@dataclass(frozen=True)
class DesktopOAuthProviderConfig:
    provider: str
    enabled: bool
    client_id: str | None
    client_secret: str | None
    redirect_uri: str | None
    authorize_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str
    scopes: tuple[str, ...]
    emails_endpoint: str | None = None
    uses_pkce: bool = True


@dataclass
class ProviderToken:
    access_token: str
    token_type: str = "Bearer"


@dataclass
class ProviderUserProfile:
    external_id: str
    email: str | None
    username: str | None
    display_name: str | None
    avatar_url: str | None


@dataclass
class DesktopOAuthStartResult:
    session_id: UUID
    authorize_url: str
    expires_in: int


@dataclass
class DesktopOAuthCallbackResult:
    session: DesktopOAuthSession
    grant: str
    user: User


class DesktopOAuthService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)
        self.provisioner = UserProvisioningService(db)
        self.auth_service = AuthService(db)

    async def start_session(
        self,
        *,
        provider: str,
        return_scheme: str | None = None,
        client_fingerprint: str | None = None,
    ) -> DesktopOAuthStartResult:
        cfg = self._get_provider_config(provider)
        state = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)
        expires_at = Datetime.now() + timedelta(seconds=settings.DESKTOP_OAUTH_SESSION_TTL_SECONDS)
        session = DesktopOAuthSession(
            provider=cfg.provider,
            state=state,
            code_verifier=code_verifier,
            redirect_scheme=(return_scheme or settings.DESKTOP_OAUTH_CALLBACK_SCHEME).strip() or settings.DESKTOP_OAUTH_CALLBACK_SCHEME,
            status=SESSION_STATUS_CREATED,
            client_fingerprint=client_fingerprint,
            expires_at=expires_at,
        )
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        authorize_url = self._build_authorize_url(cfg, state=state, code_verifier=code_verifier)
        return DesktopOAuthStartResult(
            session_id=session.id,
            authorize_url=authorize_url,
            expires_in=settings.DESKTOP_OAUTH_SESSION_TTL_SECONDS,
        )

    async def complete_callback(
        self,
        *,
        provider: str,
        code: str,
        state: str,
        client: httpx.AsyncClient,
    ) -> DesktopOAuthCallbackResult:
        cfg = self._get_provider_config(provider)
        session = await self._get_session_by_state(cfg.provider, state)
        self._ensure_session_active(session)

        token = await _exchange_provider_code(cfg, client, code=code, code_verifier=session.code_verifier)
        profile = await _fetch_provider_profile(cfg, client, token.access_token)
        email = profile.email or f"{cfg.provider}-{profile.external_id}@oauth.local"
        user = await self.provisioner.provision_user(
            email=email,
            auth_provider=cfg.provider,
            external_id=profile.external_id,
            username=profile.display_name or profile.username,
            avatar=profile.avatar_url,
        )

        session.status = SESSION_STATUS_CALLBACK_RECEIVED
        session.user_id = user.id
        session.error_code = None
        session.error_detail = None

        raw_grant = secrets.token_urlsafe(32)
        grant = DesktopOAuthGrant(
            session_id=session.id,
            grant_hash=self._hash_secret(raw_grant),
            status=GRANT_STATUS_ACTIVE,
            expires_at=Datetime.now() + timedelta(seconds=settings.DESKTOP_OAUTH_GRANT_TTL_SECONDS),
        )
        self.db.add(grant)
        session.status = SESSION_STATUS_GRANT_ISSUED
        await self.db.commit()
        await self.db.refresh(session)
        return DesktopOAuthCallbackResult(session=session, grant=raw_grant, user=user)

    async def exchange_grant(
        self,
        *,
        provider: str,
        session_id: UUID,
        state: str,
        grant: str,
    ) -> tuple[User, Any]:
        cfg = self._get_provider_config(provider)
        session = await self.db.get(DesktopOAuthSession, session_id)
        if not session or session.provider != cfg.provider:
            raise DesktopOAuthError("OAuth session not found", status.HTTP_404_NOT_FOUND)
        if session.state != state:
            raise DesktopOAuthError("OAuth state mismatch", status.HTTP_400_BAD_REQUEST)
        self._ensure_session_active(session, allow_grant_issued=True)
        grant_row = await self.db.scalar(
            select(DesktopOAuthGrant).where(DesktopOAuthGrant.session_id == session.id)
        )
        if not grant_row:
            raise DesktopOAuthError("OAuth grant not found", status.HTTP_404_NOT_FOUND)
        self._ensure_grant_active(grant_row)
        if grant_row.grant_hash != self._hash_secret(grant):
            raise DesktopOAuthError("OAuth grant invalid", status.HTTP_400_BAD_REQUEST)

        user = await self.user_repo.get_by_id(session.user_id)
        if not user:
            raise DesktopOAuthError("OAuth user not found", status.HTTP_404_NOT_FOUND)

        tokens = await self.auth_service.create_session_tokens(
            user,
            user_agent=f"Deeting Desktop ({session.client_fingerprint or 'desktop'})",
            device_type="desktop",
            device_name="Deeting Desktop",
        )
        grant_row.status = GRANT_STATUS_CONSUMED
        grant_row.consumed_at = Datetime.now()
        session.status = SESSION_STATUS_EXCHANGED
        session.completed_at = Datetime.now()
        await self.db.commit()
        return user, tokens

    @staticmethod
    def build_callback_redirect_url(*, scheme: str, provider: str, session_id: UUID, state: str, grant: str) -> str:
        query = urlencode(
            {
                "provider": provider,
                "session_id": str(session_id),
                "state": state,
                "grant": grant,
            }
        )
        return f"{scheme}://auth/callback?{query}"

    def _get_provider_config(self, provider: str) -> DesktopOAuthProviderConfig:
        normalized = (provider or "").strip().lower()
        configs = {
            "google": DesktopOAuthProviderConfig(
                provider="google",
                enabled=settings.GOOGLE_OAUTH_ENABLED,
                client_id=settings.GOOGLE_CLIENT_ID,
                client_secret=settings.GOOGLE_CLIENT_SECRET,
                redirect_uri=settings.GOOGLE_REDIRECT_URI,
                authorize_endpoint=settings.GOOGLE_AUTHORIZE_ENDPOINT,
                token_endpoint=settings.GOOGLE_TOKEN_ENDPOINT,
                userinfo_endpoint=settings.GOOGLE_USERINFO_ENDPOINT,
                scopes=("openid", "profile", "email"),
            ),
            "github": DesktopOAuthProviderConfig(
                provider="github",
                enabled=settings.GITHUB_OAUTH_ENABLED,
                client_id=settings.GITHUB_CLIENT_ID,
                client_secret=settings.GITHUB_CLIENT_SECRET,
                redirect_uri=settings.GITHUB_REDIRECT_URI,
                authorize_endpoint=settings.GITHUB_AUTHORIZE_ENDPOINT,
                token_endpoint=settings.GITHUB_TOKEN_ENDPOINT,
                userinfo_endpoint=settings.GITHUB_USERINFO_ENDPOINT,
                emails_endpoint=settings.GITHUB_EMAILS_ENDPOINT,
                scopes=("read:user", "user:email"),
            ),
        }
        cfg = configs.get(normalized)
        if not cfg:
            raise DesktopOAuthError("Unsupported OAuth provider", status.HTTP_404_NOT_FOUND)
        if not cfg.enabled:
            raise DesktopOAuthError(f"{cfg.provider} OAuth is not enabled", status.HTTP_503_SERVICE_UNAVAILABLE)
        missing = [
            name
            for name, value in {
                f"{cfg.provider.upper()}_CLIENT_ID": cfg.client_id,
                f"{cfg.provider.upper()}_CLIENT_SECRET": cfg.client_secret,
                f"{cfg.provider.upper()}_REDIRECT_URI": cfg.redirect_uri,
            }.items()
            if not value
        ]
        if missing:
            raise DesktopOAuthError(
                f"OAuth configuration missing: {', '.join(missing)}",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return cfg

    def _build_authorize_url(self, cfg: DesktopOAuthProviderConfig, *, state: str, code_verifier: str) -> str:
        params = {
            "client_id": cfg.client_id,
            "redirect_uri": cfg.redirect_uri,
            "response_type": "code",
            "state": state,
            "scope": " ".join(cfg.scopes),
        }
        if cfg.uses_pkce:
            params["code_challenge"] = _pkce_code_challenge(code_verifier)
            params["code_challenge_method"] = "S256"
        if cfg.provider == "github":
            params["allow_signup"] = "true"
        return str(httpx.URL(cfg.authorize_endpoint).copy_with(params=params))

    async def _get_session_by_state(self, provider: str, state: str) -> DesktopOAuthSession:
        session = await self.db.scalar(
            select(DesktopOAuthSession).where(
                DesktopOAuthSession.provider == provider,
                DesktopOAuthSession.state == state,
            )
        )
        if not session:
            raise DesktopOAuthError("OAuth session not found", status.HTTP_404_NOT_FOUND)
        return session

    @staticmethod
    def _ensure_session_active(session: DesktopOAuthSession, *, allow_grant_issued: bool = False) -> None:
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < Datetime.now():
            session.status = SESSION_STATUS_EXPIRED
            raise DesktopOAuthError("OAuth session expired", status.HTTP_400_BAD_REQUEST)
        allowed = {SESSION_STATUS_CREATED, SESSION_STATUS_CALLBACK_RECEIVED}
        if allow_grant_issued:
            allowed.add(SESSION_STATUS_GRANT_ISSUED)
        if session.status not in allowed:
            raise DesktopOAuthError("OAuth session is not active", status.HTTP_400_BAD_REQUEST)

    @staticmethod
    def _ensure_grant_active(grant: DesktopOAuthGrant) -> None:
        expires_at = grant.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < Datetime.now():
            grant.status = GRANT_STATUS_EXPIRED
            raise DesktopOAuthError("OAuth grant expired", status.HTTP_400_BAD_REQUEST)
        if grant.status != GRANT_STATUS_ACTIVE:
            raise DesktopOAuthError("OAuth grant already consumed", status.HTTP_400_BAD_REQUEST)

    @staticmethod
    def _hash_secret(raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _pkce_code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")


async def _exchange_provider_code(
    cfg: DesktopOAuthProviderConfig,
    client: httpx.AsyncClient,
    *,
    code: str,
    code_verifier: str,
) -> ProviderToken:
    payload = {
        "client_id": cfg.client_id,
        "client_secret": cfg.client_secret,
        "code": code,
        "redirect_uri": cfg.redirect_uri,
    }
    if cfg.uses_pkce:
        payload["code_verifier"] = code_verifier
    headers = {"Accept": "application/json"}
    response = await client.post(cfg.token_endpoint, data=payload, headers=headers)
    if response.status_code >= 400:
        raise DesktopOAuthError(
            f"{cfg.provider} token exchange failed",
            status.HTTP_502_BAD_GATEWAY,
        )
    data = response.json()
    token = data.get("access_token")
    if not isinstance(token, str) or not token.strip():
        raise DesktopOAuthError(
            f"{cfg.provider} token response missing access_token",
            status.HTTP_502_BAD_GATEWAY,
        )
    return ProviderToken(access_token=token, token_type=str(data.get("token_type") or "Bearer"))


async def _fetch_provider_profile(
    cfg: DesktopOAuthProviderConfig,
    client: httpx.AsyncClient,
    access_token: str,
) -> ProviderUserProfile:
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    response = await client.get(cfg.userinfo_endpoint, headers=headers)
    if response.status_code >= 400:
        raise DesktopOAuthError(
            f"{cfg.provider} userinfo fetch failed",
            status.HTTP_502_BAD_GATEWAY,
        )
    data: dict[str, Any] = response.json()
    if cfg.provider == "google":
        external_id = str(data.get("sub") or "")
        if not external_id:
            raise DesktopOAuthError("google userinfo missing sub", status.HTTP_502_BAD_GATEWAY)
        return ProviderUserProfile(
            external_id=external_id,
            email=_optional_text(data.get("email")),
            username=_optional_text(data.get("email")),
            display_name=_optional_text(data.get("name")),
            avatar_url=_optional_text(data.get("picture")),
        )

    external_id = str(data.get("id") or "")
    if not external_id:
        raise DesktopOAuthError("github userinfo missing id", status.HTTP_502_BAD_GATEWAY)
    email = _optional_text(data.get("email"))
    if not email and cfg.emails_endpoint:
        emails_resp = await client.get(cfg.emails_endpoint, headers=headers)
        if emails_resp.status_code < 400:
            emails = emails_resp.json()
            if isinstance(emails, list):
                primary = next((item for item in emails if item.get("primary")), None)
                verified = next((item for item in emails if item.get("verified")), None)
                chosen = primary or verified or (emails[0] if emails else None)
                if isinstance(chosen, dict):
                    email = _optional_text(chosen.get("email"))
    return ProviderUserProfile(
        external_id=external_id,
        email=email,
        username=_optional_text(data.get("login")),
        display_name=_optional_text(data.get("name")) or _optional_text(data.get("login")),
        avatar_url=_optional_text(data.get("avatar_url")),
    )


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


__all__ = [
    "DesktopOAuthService",
    "DesktopOAuthError",
    "DesktopOAuthStartResult",
    "DesktopOAuthCallbackResult",
    "_exchange_provider_code",
    "_fetch_provider_profile",
]
