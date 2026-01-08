"""
LinuxDo OAuth 登录/绑定服务（迁移自 backend_old，并适配异步/新架构）。

职责：
- 生成授权跳转 URL（含 state 幂等校验）
- 使用授权码换取 access token
- 拉取 LinuxDo 用户信息
- 基于 external_id 同步/创建本地用户与 Identity 绑定
- 返回本地用户实体供上层签发 JWT
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.config import settings
from app.core.logging import logger
from app.models import User
from app.services.users.user_provisioning_service import UserProvisioningService

LINUXDO_PROVIDER = "linuxdo"
STATE_STORAGE_KEY = "auth:oauth:linuxdo:state:{state}"
STATE_TTL_SECONDS = 300


class LinuxDoOAuthError(HTTPException):
    """封装 OAuth 相关错误为 HTTPException，便于路由捕获。"""

    def __init__(self, detail: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(status_code=status_code, detail=detail)


@dataclass
class LinuxDoToken:
    access_token: str
    token_type: str
    expires_in: int | None


@dataclass
class LinuxDoUserProfile:
    external_id: str
    username: str | None
    display_name: str | None
    avatar_url: str | None
    is_active: bool


def _ensure_enabled() -> None:
    if not settings.LINUXDO_OAUTH_ENABLED:
        raise LinuxDoOAuthError("LinuxDo OAuth 尚未启用", status.HTTP_503_SERVICE_UNAVAILABLE)

    required = {
        "LINUXDO_CLIENT_ID": settings.LINUXDO_CLIENT_ID,
        "LINUXDO_CLIENT_SECRET": settings.LINUXDO_CLIENT_SECRET,
        "LINUXDO_REDIRECT_URI": settings.LINUXDO_REDIRECT_URI,
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        raise LinuxDoOAuthError(
            f"LinuxDo OAuth 配置缺失: {', '.join(missing)}",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )


async def build_authorize_url(invite_code: str | None = None) -> str:
    """生成携带 state 的授权 URL，并将 state 写入 Redis 以防重放。

    invite_code（如有）会被加密存入 state 对应的缓存，以便回调时消费。
    """

    _ensure_enabled()
    state = secrets.token_urlsafe(32)
    await cache.set(
        STATE_STORAGE_KEY.format(state=state),
        {
            "provider": LINUXDO_PROVIDER,
            "created_at": datetime.now(UTC),
            "invite_code": invite_code,
        },
        ttl=STATE_TTL_SECONDS,
    )

    base = httpx.URL(settings.LINUXDO_AUTHORIZE_ENDPOINT)
    params = dict(base.params)
    params.update(
        {
            "client_id": settings.LINUXDO_CLIENT_ID,
            "redirect_uri": settings.LINUXDO_REDIRECT_URI,
            "response_type": "code",
            "state": state,
        }
    )
    return str(base.copy_with(params=params))


async def complete_oauth(
    *,
    db: AsyncSession,
    client: httpx.AsyncClient,
    code: str,
    state: str | None,
) -> User:
    """完成 LinuxDo OAuth 流程，返回本地用户。

    - 校验 state 并提取 invite_code
    - 换取用户信息
    - 通过统一的 UserProvisioning 管线创建/绑定用户
    """

    _ensure_enabled()
    if not code:
        raise LinuxDoOAuthError("缺少授权码参数")
    if not state:
        raise LinuxDoOAuthError("缺少 state 参数")

    state_data = await _consume_state(state)
    invite_code = state_data.get("invite_code")

    token = await _exchange_code(client, code)
    profile = await _fetch_profile(client, token.access_token)

    provisioner = UserProvisioningService(db)

    # 目前 LinuxDo 返回的 profile 不包含邮箱，使用 external_id 衍生邮箱作为锚点
    synthetic_email = f"{profile.external_id}@linux.do"

    user = await provisioner.provision_user(
        email=synthetic_email,
        auth_provider=LINUXDO_PROVIDER,
        external_id=profile.external_id,
        invite_code=invite_code,
        username=profile.display_name or profile.username,
        avatar=profile.avatar_url,
    )

    return user


async def _consume_state(state: str) -> dict:
    stored = await cache.get(STATE_STORAGE_KEY.format(state=state))
    await cache.delete(STATE_STORAGE_KEY.format(state=state))

    if not stored or stored.get("provider") != LINUXDO_PROVIDER:
        raise LinuxDoOAuthError("state 无效或已过期")

    return stored


async def _exchange_code(client: httpx.AsyncClient, code: str) -> LinuxDoToken:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.LINUXDO_REDIRECT_URI,
        "client_id": settings.LINUXDO_CLIENT_ID,
        "client_secret": settings.LINUXDO_CLIENT_SECRET,
    }

    try:
        resp = await client.post(settings.LINUXDO_TOKEN_ENDPOINT, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    except httpx.HTTPError as exc:  # pragma: no cover
        raise LinuxDoOAuthError(f"LinuxDo token 接口请求失败: {exc}", status.HTTP_502_BAD_GATEWAY)

    if resp.status_code >= 400:
        raise LinuxDoOAuthError(
            f"LinuxDo token 接口返回错误状态 {resp.status_code}",
            status.HTTP_502_BAD_GATEWAY,
        )

    payload: dict[str, Any]
    try:
        payload = resp.json()
    except ValueError as exc:
        raise LinuxDoOAuthError("LinuxDo token 接口返回非 JSON 数据", status.HTTP_502_BAD_GATEWAY) from exc

    access_token = payload.get("access_token")
    if not isinstance(access_token, str):
        raise LinuxDoOAuthError("LinuxDo token 接口缺少 access_token", status.HTTP_502_BAD_GATEWAY)

    token_type = payload.get("token_type") or "Bearer"
    expires_in = payload.get("expires_in")
    try:
        expires = int(expires_in) if expires_in is not None else None
    except Exception:  # pragma: no cover - 容忍非整数
        expires = None

    return LinuxDoToken(access_token=access_token, token_type=str(token_type), expires_in=expires)


async def _fetch_profile(client: httpx.AsyncClient, access_token: str) -> LinuxDoUserProfile:
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        resp = await client.get(settings.LINUXDO_USERINFO_ENDPOINT, headers=headers)
    except httpx.HTTPError as exc:  # pragma: no cover
        raise LinuxDoOAuthError(f"LinuxDo 用户信息接口请求失败: {exc}", status.HTTP_502_BAD_GATEWAY)

    if resp.status_code >= 400:
        raise LinuxDoOAuthError(
            f"LinuxDo 用户信息接口返回错误状态 {resp.status_code}",
            status.HTTP_502_BAD_GATEWAY,
        )

    try:
        payload: dict[str, Any] = resp.json()
    except ValueError as exc:
        raise LinuxDoOAuthError("LinuxDo 用户信息接口返回非 JSON 数据", status.HTTP_502_BAD_GATEWAY) from exc

    user_payload = payload.get("user") if isinstance(payload.get("user"), dict) else payload
    user_id = user_payload.get("id")
    if user_id is None:
        raise LinuxDoOAuthError("LinuxDo 用户信息缺少 id", status.HTTP_502_BAD_GATEWAY)

    username = user_payload.get("username")
    name = user_payload.get("name")
    avatar_template = user_payload.get("avatar_template")
    is_active = user_payload.get("active", True)

    return LinuxDoUserProfile(
        external_id=str(user_id),
        username=str(username) if username else None,
        display_name=str(name) if name else (str(username) if username else None),
        avatar_url=_build_avatar_url(avatar_template),
        is_active=bool(is_active),
    )


def _build_avatar_url(template: Any) -> str | None:
    if not isinstance(template, str):
        return None
    url = template.replace("{size}", "240")
    if url.startswith("//"):
        url = f"https:{url}"
    return url
