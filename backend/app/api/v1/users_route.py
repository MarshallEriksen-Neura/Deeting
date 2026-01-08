"""
用户自助 API 路由 (/api/v1/users)

端点:
- POST /users/register - 注册新用户，发送激活验证码
- POST /users/activate - 验证码激活账号
- POST /users/reset-password - 请求密码重置验证码
- POST /users/reset-password/confirm - 验证码确认重置密码
- GET /users/me - 获取当前用户信息 + 权限 flags
- PATCH /users/me - 更新个人信息（username 等）
- POST /users/me/change-password - 修改密码

遵循 AGENTS.md 最佳实践:
- 路由"瘦身"：只做入参校验、鉴权/依赖注入、调用 Service
- 业务逻辑封装在 Service 层
- 禁止在路由中直接操作 ORM/Session
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user, get_permission_flags
from app.models import User
from app.schemas.auth import (
    ActivateRequest,
    ChangePasswordRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordConfirmRequest,
    ResetPasswordRequest,
)
from app.schemas.user import UserRead, UserUpdate, UserWithPermissions
from app.services.users import AuthService, UserService

router = APIRouter(prefix="/users", tags=["Users"])


@router.post("/register", response_model=MessageResponse)
async def register(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    用户注册

    - 创建未激活用户
    - 发送激活验证码到邮箱
    - 返回成功消息
    """
    service = AuthService(db)
    await service.register_user(
        email=request.email,
        password=request.password,
        username=request.username,
        invite_code=request.invite_code,
    )

    return MessageResponse(
        message="Registration successful. Please check your email for activation code."
    )


@router.post("/activate", response_model=MessageResponse)
async def activate(
    request: ActivateRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    激活账号

    - 验证 6 位验证码
    - 激活用户账号
    """
    service = AuthService(db)
    await service.activate_user(request.email, request.code)

    return MessageResponse(message="Account activated successfully. You can now login.")


@router.post("/reset-password", response_model=MessageResponse)
async def request_reset_password(
    request: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    请求密码重置

    - 发送 6 位验证码到邮箱
    - 无论邮箱是否存在都返回相同消息（安全考虑）
    """
    service = AuthService(db)
    await service.request_password_reset(request.email)

    # 不透露用户是否存在
    return MessageResponse(
        message="If the email exists, a verification code has been sent."
    )


@router.post("/reset-password/confirm", response_model=MessageResponse)
async def confirm_reset_password(
    request: ResetPasswordConfirmRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    确认密码重置

    - 验证 6 位验证码
    - 设置新密码
    """
    service = AuthService(db)
    await service.confirm_password_reset(
        email=request.email,
        code=request.code,
        new_password=request.new_password,
    )

    return MessageResponse(message="Password has been reset successfully.")


@router.get("/me", response_model=UserWithPermissions)
async def get_current_user_info(
    user: User = Depends(get_current_active_user),
    permission_flags: dict[str, int] = Depends(get_permission_flags),
) -> UserWithPermissions:
    """
    获取当前用户信息

    - 返回用户基本信息
    - 包含权限标记 {can_xxx: 0/1}
    """
    return UserWithPermissions(
        id=user.id,
        email=user.email,
        username=user.username,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        created_at=user.created_at,
        updated_at=user.updated_at,
        permission_flags=permission_flags,
    )


@router.patch("/me", response_model=UserRead)
async def update_current_user(
    request: UserUpdate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """
    更新当前用户信息

    - 允许修改 username 等非敏感字段
    """
    service = UserService(db)
    return await service.update_profile(user, request)


@router.post("/me/change-password", response_model=MessageResponse)
async def change_password(
    request: ChangePasswordRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    修改密码

    - 验证旧密码
    - 设置新密码
    - 修改成功后 token_version 递增，旧 token 将失效，需要重新登录
    """
    service = AuthService(db)
    await service.change_password(
        user=user,
        old_password=request.old_password,
        new_password=request.new_password,
    )

    return MessageResponse(message="Password changed successfully.")
