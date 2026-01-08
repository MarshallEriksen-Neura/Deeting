"""
管理员用户管理 API 路由 (/api/v1/admin/users)

端点:
- GET /admin/users - 用户列表（分页、筛选）[权限: user.manage]
- POST /admin/users - 创建用户（发送密码重置链接）[权限: user.manage]
- GET /admin/users/{user_id} - 获取用户详情 [权限: user.manage]
- PATCH /admin/users/{user_id} - 更新用户状态 [权限: user.manage]
- POST /admin/users/{user_id}/roles - 分配/移除角色 [权限: role.manage]
- POST /admin/users/{user_id}/ban - 封禁用户 [权限: user.manage]
- POST /admin/users/{user_id}/unban - 解封用户 [权限: user.manage]
- GET /admin/roles - 获取所有角色 [权限: role.view]
- GET /admin/permissions - 获取所有权限 [权限: role.view]

遵循 AGENTS.md 最佳实践:
- 路由"瘦身"：只做入参校验、鉴权/依赖注入、调用 Service
- 业务逻辑封装在 Service 层
- 禁止在路由中直接操作 ORM/Session
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import clear_permission_cache, require_permissions
from app.models import User
from app.schemas.auth import MessageResponse
from app.schemas.user import (
    BanRequest,
    PermissionRead,
    RoleAssignment,
    RoleRead,
    UserAdminUpdate,
    UserCreate,
    UserListResponse,
    UserRead,
    UserWithRoles,
)
from app.services.users import UserAdminService

router = APIRouter(prefix="/admin", tags=["Admin - Users"])


@router.get(
    "/users",
    response_model=UserListResponse,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def list_users(
    skip: int = Query(0, ge=0, description="跳过数量"),
    limit: int = Query(20, ge=1, le=100, description="每页数量"),
    email: str | None = Query(None, description="邮箱筛选（模糊）"),
    is_active: bool | None = Query(None, description="是否激活"),
    is_superuser: bool | None = Query(None, description="是否超管"),
    db: AsyncSession = Depends(get_db),
) -> UserListResponse:
    """
    获取用户列表

    - 支持分页
    - 支持邮箱模糊搜索
    - 支持状态筛选
    """
    service = UserAdminService(db)
    return await service.list_users(
        skip=skip,
        limit=limit,
        email=email,
        is_active=is_active,
        is_superuser=is_superuser,
    )


@router.post(
    "/users",
    response_model=UserRead,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def create_user(
    request: UserCreate,
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """
    管理员创建用户

    - 创建已激活的用户
    - 发送密码重置链接到邮箱
    """
    service = UserAdminService(db)
    return await service.create_user(request)


@router.get(
    "/users/{user_id}",
    response_model=UserWithRoles,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def get_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> UserWithRoles:
    """
    获取用户详情（含角色）
    """
    service = UserAdminService(db)
    return await service.get_user(user_id)


@router.patch(
    "/users/{user_id}",
    response_model=UserRead,
)
async def update_user(
    user_id: UUID,
    request: UserAdminUpdate,
    current_admin: User = Depends(require_permissions(["user.manage"])),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    """
    更新用户状态

    - 可修改 is_active, is_superuser, username
    """
    service = UserAdminService(db)
    return await service.update_user(user_id, request, current_admin)


@router.post(
    "/users/{user_id}/roles",
    response_model=MessageResponse,
    dependencies=[Depends(require_permissions(["role.manage"]))],
)
async def manage_user_roles(
    user_id: UUID,
    request: RoleAssignment,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    分配/移除用户角色

    - action: "add" 或 "remove"
    - 角色变更后自动清除权限缓存
    """
    service = UserAdminService(db)

    if request.action == "add":
        await service.assign_roles(user_id, request.role_ids)
        action_msg = "assigned"
    else:
        await service.remove_roles(user_id, request.role_ids)
        action_msg = "removed"

    # 清除权限缓存
    await clear_permission_cache(user_id)

    return MessageResponse(message=f"Roles {action_msg} successfully")


@router.post(
    "/users/{user_id}/ban",
    response_model=MessageResponse,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def ban_user(
    user_id: UUID,
    request: BanRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    封禁用户

    - 可设置封禁时长（小时），不设置为永久
    - 立即使用户所有 token 失效
    """
    service = UserAdminService(db)
    message = await service.ban_user(
        user_id=user_id,
        reason=request.reason,
        duration_hours=request.duration_hours,
    )
    return MessageResponse(message=message)


@router.post(
    "/users/{user_id}/unban",
    response_model=MessageResponse,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def unban_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    解封用户
    """
    service = UserAdminService(db)
    await service.unban_user(user_id)
    return MessageResponse(message="User unbanned successfully")


@router.get(
    "/roles",
    response_model=list[RoleRead],
    dependencies=[Depends(require_permissions(["role.view"]))],
)
async def list_roles(
    db: AsyncSession = Depends(get_db),
) -> list[RoleRead]:
    """
    获取所有角色
    """
    service = UserAdminService(db)
    return await service.list_roles()


@router.get(
    "/permissions",
    response_model=list[PermissionRead],
    dependencies=[Depends(require_permissions(["role.view"]))],
)
async def list_permissions(
    db: AsyncSession = Depends(get_db),
) -> list[PermissionRead]:
    """
    获取所有权限
    """
    service = UserAdminService(db)
    return await service.list_permissions()
