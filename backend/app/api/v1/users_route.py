"""
用户自助 API 路由 (/api/v1/users)

端点:
- POST /users/reset-password (deprecated) - 已移除密码体系
- GET /users/me - 获取当前用户信息 + 权限 flags
- PATCH /users/me - 更新个人信息（username 等）
- POST /users/me/change-password (deprecated) - 已移除密码体系

遵循 AGENTS.md 最佳实践:
- 路由"瘦身"：只做入参校验、鉴权/依赖注入、调用 Service
- 业务逻辑封装在 Service 层
- 禁止在路由中直接操作 ORM/Session
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user, get_permission_flags
from app.models import User
from app.schemas.auth import MessageResponse
from app.schemas.user import UserRead, UserUpdate, UserWithPermissions
from app.schemas.secretary import UserSecretaryDTO, UserSecretaryUpdateRequest
from app.repositories import ProviderModelRepository, UserSecretaryRepository
from app.services.secretary.secretary_service import UserSecretaryService
from app.services.users import UserService

router = APIRouter(prefix="/users", tags=["Users"])


def get_secretary_service(db: AsyncSession = Depends(get_db)) -> UserSecretaryService:
    return UserSecretaryService(
        UserSecretaryRepository(db),
        ProviderModelRepository(db),
    )


@router.post("/reset-password", response_model=MessageResponse, include_in_schema=False)
async def deprecated_reset_password():  # pragma: no cover - 兼容提示
    """已废弃：密码登录已移除。"""
    return MessageResponse(message="Password login removed; use email code or OAuth")


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


@router.get("/me/secretary", response_model=UserSecretaryDTO)
async def get_user_secretary(
    user: User = Depends(get_current_active_user),
    service: UserSecretaryService = Depends(get_secretary_service),
) -> UserSecretaryDTO:
    secretary = await service.get_or_create(user.id)
    return UserSecretaryDTO.model_validate(secretary)


@router.patch("/me/secretary", response_model=UserSecretaryDTO)
async def update_user_secretary(
    payload: UserSecretaryUpdateRequest,
    user: User = Depends(get_current_active_user),
    service: UserSecretaryService = Depends(get_secretary_service),
) -> UserSecretaryDTO:
    if payload.model_name is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="至少提供 model_name",
        )
    try:
        secretary = await service.update_settings(
            user_id=user.id,
            model_name=payload.model_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return UserSecretaryDTO.model_validate(secretary)


@router.post("/me/change-password", response_model=MessageResponse, include_in_schema=False)
async def change_password_deprecated():
    """密码登录已移除，保留兼容端点。"""
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Password login removed; use email code")
