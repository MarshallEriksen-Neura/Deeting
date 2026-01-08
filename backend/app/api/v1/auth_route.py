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

from fastapi import APIRouter, Depends, Header
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


@router.post("/login", response_model=TokenPair)
async def login(
    request: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    """
    用户登录

    - 验证邮箱和密码
    - 检查登录限流
    - 返回 access_token 和 refresh_token
    """
    service = AuthService(db)
    return await service.login(request.email, request.password)


@router.post("/refresh", response_model=TokenPair)
async def refresh_token(
    request: RefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    """
    刷新 Token

    - 验证 refresh_token
    - 实现轮换策略（旧 token 失效）
    - 返回新的 token pair
    """
    service = AuthService(db)
    return await service.refresh_tokens(request.refresh_token)


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
    return OAuthCallbackResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        token_type="bearer",
        user_id=str(user.id),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    user: User = Depends(get_current_user),
    authorization: str | None = Header(default=None, alias="Authorization"),
    refresh_token: str | None = Header(default=None, alias="X-Refresh-Token"),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    用户登出

    - 将当前 access_token 加入黑名单
    - 可选：通过 X-Refresh-Token 头传入 refresh_token 一并失效
    """
    service = AuthService(db)
    await service.logout_with_tokens(user.id, authorization, refresh_token)

    return MessageResponse(message="Successfully logged out")
