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
    Request,
    Response,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.http_client import create_async_http_client
from app.deps.auth import get_current_user
from app.models import User
from app.schemas.auth import (
    LoginRequest,
    MessageResponse,
    RefreshRequest,
    SendLoginCodeRequest,
    TokenPair,
    OAuthCallbackRequest,
    OAuthCallbackResponse,
)
from app.services.users import AuthService
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


def _refresh_cookie_secure() -> bool:
    """
    根据环境决定是否设置 Secure：
    - 开发模式（DEBUG=True 或 MODE/ENVIRONMENT=development）禁用 Secure，便于 http 本地调试
    - 其他环境启用 Secure
    """
    mode = os.getenv("MODE", "").lower()
    env = (settings.ENVIRONMENT or "").lower()
    return not (
        settings.DEBUG
        or mode == "development"
        or env == "development"
    )


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


@router.post("/login/code", response_model=MessageResponse)
async def send_login_code(
    payload: SendLoginCodeRequest,
    req: Request,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """发送邮箱验证码（无密码登录入口，支持携带邀请码用于首登注册）。"""
    service = AuthService(db)
    client_ip = (
        req.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (req.client.host if req.client else None)
    )
    await service.send_login_code(
        email=payload.email,
        invite_code=payload.invite_code,
        client_ip=client_ip,
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
    client_ip = (
        raw_request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (raw_request.client.host if raw_request.client else None)
    )
    tokens = await service.login_with_code(
        email=request.email,
        code=request.code,
        invite_code=request.invite_code,
        username=request.username,
        client_ip=client_ip,
    )
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

    - 优先读取请求体 refresh_token；若缺省则回退到 HttpOnly Cookie
    - 实现轮换策略（旧 token 失效）
    - 返回新的 token pair 并重写 Cookie
    """
    refresh_token_value = request.refresh_token if request else refresh_cookie
    if not refresh_token_value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    service = AuthService(db)
    tokens = await service.refresh_tokens(refresh_token_value)
    _set_refresh_cookie(response, tokens.refresh_token)
    return tokens


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
    tokens = await auth.create_tokens(user)
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
    _clear_refresh_cookie(response)

    return MessageResponse(message="Successfully logged out")
