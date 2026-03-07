"""
认证 API 路由 (/api/v1/auth)

端点:
- POST /auth/login - 登录获取 token pair
- POST /auth/refresh - 刷新 access token (轮换 refresh token)
- POST /auth/logout - 登出失效当前 token

遵循 AGENTS.md 最佳实践:
- 路由"瘦身"：只做入参校验、鉴权/依赖注入、调用 Service
- 业务逻辑封装在 Service 层
- 禁止在路由中直接操作 ORM/Session
"""

import os

from fastapi import (
    APIRouter,
    Body,
    Cookie,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.http_client import create_async_http_client
from app.core.logging import logger
from app.deps.auth import get_current_user
from app.models import User
from app.schemas.auth import (
    DesktopOAuthExchangeRequest,
    DesktopOAuthExchangeResponse,
    DesktopOAuthStartRequest,
    DesktopOAuthStartResponse,
    LoginRequest,
    MessageResponse,
    OAuthCallbackRequest,
    OAuthCallbackResponse,
    RefreshRequest,
    SendLoginCodeRequest,
    TokenPair,
)
from app.services.users import AuthService, DesktopOAuthError, DesktopOAuthService
from app.services.users.oauth_linuxdo_service import (
    LinuxDoOAuthError,
    build_authorize_url,
    complete_oauth,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_MAX_AGE = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
# 以 API 前缀为作用域，便于前端请求自动携带
REFRESH_COOKIE_PATH = settings.API_V1_STR


def _extract_client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    return forwarded_for.split(",")[0].strip() or (
        request.client.host if request.client else None
    )


def _extract_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _refresh_cookie_secure() -> bool:
    """
    根据环境决定是否设置 Secure：
    - 开发模式（DEBUG=True 或 MODE/ENVIRONMENT=development）禁用 Secure，便于 http 本地调试
    - 其他环境启用 Secure
    """
    mode = os.getenv("MODE", "").lower()
    env = (settings.ENVIRONMENT or "").lower()
    return not (settings.DEBUG or mode == "development" or env == "development")


def _set_refresh_cookie(response: Response, token: str) -> None:
    """写入 HttpOnly refresh token，前端只需开启 withCredentials 即可自动携带。"""
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=REFRESH_COOKIE_MAX_AGE,
        expires=REFRESH_COOKIE_MAX_AGE,
        httponly=True,
        secure=_refresh_cookie_secure(),
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """删除 refresh token Cookie。"""
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        samesite="lax",
    )


def _normalize_refresh_token(raw: str | None) -> str | None:
    """
    规范化 refresh token 输入：
    - 支持 `refresh_token=<jwt>` 形式
    - 容忍误传整段 Cookie 字符串，仅截取第一个 `;` 前内容
    """
    if not raw:
        return None
    token = raw.strip()
    if token.startswith(f"{REFRESH_COOKIE_NAME}="):
        token = token[len(f"{REFRESH_COOKIE_NAME}=") :]
    if ";" in token:
        token = token.split(";", 1)[0].strip()
    return token or None


@router.post("/login/code", response_model=MessageResponse)
async def send_login_code(
    payload: SendLoginCodeRequest,
    req: Request,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """发送邮箱验证码（无密码登录入口，支持携带邀请码用于首登注册）。"""
    service = AuthService(db)
    await service.send_login_code(
        email=payload.email,
        invite_code=payload.invite_code,
        client_ip=_extract_client_ip(req),
    )
    return MessageResponse(message="Verification code sent")


@router.post("/login", response_model=TokenPair)
async def login(
    request: LoginRequest,
    raw_request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    """
    邮箱验证码登录

    - 发送验证码后提交 code 完成登录/自动注册
    - 首次登录可携带 invite_code 与 username
    """
    service = AuthService(db)
    tokens = await service.login_with_code(
        email=request.email,
        code=request.code,
        invite_code=request.invite_code,
        username=request.username,
        client_ip=_extract_client_ip(raw_request),
        user_agent=_extract_user_agent(raw_request),
    )
    await db.commit()
    _set_refresh_cookie(response, tokens.refresh_token)
    return tokens


@router.post("/refresh", response_model=TokenPair)
async def refresh_token(
    response: Response,
    request: RefreshRequest | None = Body(default=None),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    """
    刷新 Token

    - 优先读取 HttpOnly Cookie；若缺省则回退到请求体 refresh_token
    - 实现轮换策略（旧 token 失效）
    - 返回新的 token pair 并重写 Cookie
    """
    cookie_token = _normalize_refresh_token(refresh_cookie)
    body_token = _normalize_refresh_token(request.refresh_token) if request else None
    if cookie_token and body_token and cookie_token != body_token:
        logger.warning("refresh_token_mismatch_cookie_body", extra={"use": "cookie"})
    refresh_token_value = cookie_token or body_token
    if not refresh_token_value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    service = AuthService(db)
    tokens = await service.refresh_tokens(refresh_token_value)
    await db.commit()
    _set_refresh_cookie(response, tokens.refresh_token)
    return tokens


@router.post("/oauth/desktop/start", response_model=DesktopOAuthStartResponse)
async def desktop_oauth_start(
    payload: DesktopOAuthStartRequest,
    db: AsyncSession = Depends(get_db),
) -> DesktopOAuthStartResponse:
    service = DesktopOAuthService(db)
    try:
        result = await service.start_session(
            provider=payload.provider,
            return_scheme=payload.return_scheme,
            client_fingerprint=payload.platform,
        )
    except DesktopOAuthError as exc:
        raise exc
    return DesktopOAuthStartResponse(
        session_id=str(result.session_id),
        authorize_url=result.authorize_url,
        expires_in=result.expires_in,
    )


@router.get("/oauth/{provider}/callback", status_code=307)
async def desktop_oauth_callback(
    provider: str,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    service = DesktopOAuthService(db)
    client = create_async_http_client()
    try:
        result = await service.complete_callback(
            provider=provider,
            code=code,
            state=state,
            client=client,
        )
    except DesktopOAuthError as exc:
        raise exc
    finally:
        await client.aclose()

    return RedirectResponse(
        service.build_callback_redirect_url(
            scheme=result.session.redirect_scheme,
            provider=result.session.provider,
            session_id=result.session.id,
            state=result.session.state,
            grant=result.grant,
        ),
        status_code=307,
    )


@router.post("/oauth/desktop/exchange", response_model=DesktopOAuthExchangeResponse)
async def desktop_oauth_exchange(
    payload: DesktopOAuthExchangeRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> DesktopOAuthExchangeResponse:
    service = DesktopOAuthService(db)
    try:
        user, tokens = await service.exchange_grant(
            provider=payload.provider,
            session_id=payload.session_id,
            state=payload.state,
            grant=payload.grant,
        )
    except DesktopOAuthError as exc:
        raise exc
    _set_refresh_cookie(response, tokens.refresh_token)
    return DesktopOAuthExchangeResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        token_type=tokens.token_type,
        user={
            "id": str(user.id),
            "email": user.email,
            "name": user.username,
        },
    )


@router.get("/oauth/linuxdo/authorize", status_code=307)
async def linuxdo_authorize(invite_code: str | None = None):
    """生成 LinuxDo 授权 URL 并 307 重定向，可携带邀请码。"""
    try:
        url = await build_authorize_url(invite_code)
    except LinuxDoOAuthError as exc:
        # 直接抛出 HTTPException
        raise exc
    from fastapi.responses import RedirectResponse

    return RedirectResponse(url, status_code=307)


@router.post("/oauth/callback", response_model=OAuthCallbackResponse)
async def linuxdo_callback(
    payload: OAuthCallbackRequest,
    response: Response,
    raw_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """处理 LinuxDo OAuth 回调，返回 JWT。"""
    client = create_async_http_client()
    try:
        user = await complete_oauth(
            db=db,
            client=client,
            code=payload.code,
            state=payload.state,
        )
    except LinuxDoOAuthError as exc:
        raise exc
    finally:
        await client.aclose()

    # 复用现有登录颁发逻辑
    auth = AuthService(db)
    tokens = await auth.create_session_tokens(
        user,
        client_ip=_extract_client_ip(raw_request),
        user_agent=_extract_user_agent(raw_request),
    )
    await db.commit()
    _set_refresh_cookie(response, tokens.refresh_token)
    return OAuthCallbackResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        token_type="bearer",
        user_id=str(user.id),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    response: Response,
    user: User = Depends(get_current_user),
    authorization: str | None = Header(default=None, alias="Authorization"),
    refresh_token_header: str | None = Header(default=None, alias="X-Refresh-Token"),
    refresh_cookie: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    用户登出

    - 将当前 access_token 加入黑名单
    - 可选：通过 X-Refresh-Token 头或 Cookie 传入 refresh_token 一并失效
    """
    service = AuthService(db)
    refresh_token = refresh_token_header or refresh_cookie
    await service.logout_with_tokens(user.id, authorization, refresh_token)
    await db.commit()
    _clear_refresh_cookie(response)

    return MessageResponse(message="Successfully logged out")
