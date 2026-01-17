"""
用户管理服务：管理员对用户的增删改查、角色分配、封禁解封

遵循 AGENTS.md 最佳实践:
- Service 负责业务逻辑，不在路由中直接操作 ORM/Repository
- 业务异常在 Service 内抛出 HTTPException
- 统一日志字段方便审计
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models import User
from app.repositories import UserRepository
from app.schemas.user import (
    PermissionRead,
    RoleRead,
    UserAdminUpdate,
    UserCreate,
    UserListResponse,
    UserRead,
    UserWithRoles,
)
from app.services.users.auth_service import AuthService
from app.services.assistant.default_assistant_service import DefaultAssistantService


class UserAdminService:
    """管理员用户管理服务"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)
        self.auth_service = AuthService(db)

    async def list_users(
        self,
        skip: int = 0,
        limit: int = 20,
        email: str | None = None,
        is_active: bool | None = None,
        is_superuser: bool | None = None,
    ) -> UserListResponse:
        """获取用户列表（分页、筛选）"""
        users, total = await self.user_repo.list_users(
            skip=skip,
            limit=limit,
            email_filter=email,
            is_active=is_active,
            is_superuser=is_superuser,
        )

        return UserListResponse(
            items=[
                UserRead(
                    id=u.id,
                    email=u.email,
                    username=u.username,
                    is_active=u.is_active,
                    is_superuser=u.is_superuser,
                    created_at=u.created_at,
                    updated_at=u.updated_at,
                )
                for u in users
            ],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def create_user(self, request: UserCreate) -> UserRead:
        """
        管理员创建用户

        - 创建已激活的用户
        - 发送密码重置链接到邮箱
        """
        # 注册用户（会自动发送验证码）
        user = await self.auth_service.register_user(
            email=request.email,
            password=request.password,
            username=request.username,
        )

        # 管理员创建的用户直接激活
        user = await self.user_repo.activate_user(user.id)
        await self._ensure_default_assistant(user)

        logger.info(
            "admin_created_user",
            extra={"new_user_id": str(user.id), "email": user.email},
        )

        return UserRead(
            id=user.id,
            email=user.email,
            username=user.username,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )

    async def get_user(self, user_id: UUID) -> UserWithRoles:
        """获取用户详情（含角色）"""
        user = await self.user_repo.get_user_with_roles(user_id)

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        return UserWithRoles(
            id=user.id,
            email=user.email,
            username=user.username,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
            updated_at=user.updated_at,
            roles=[
                RoleRead(
                    id=role.id,
                    name=role.name,
                    description=role.description,
                )
                for role in user.roles
            ],
        )

    async def update_user(
        self,
        user_id: UUID,
        request: UserAdminUpdate,
        current_admin: User,
    ) -> UserRead:
        """
        更新用户状态

        - 可修改 is_active, is_superuser, username
        - 只有超管可以修改 is_superuser 字段
        """
        # 检查用户是否存在
        user = await self._get_user_or_404(user_id)
        was_active = user.is_active

        # 更新字段
        update_data = request.model_dump(exclude_unset=True)

        # 权限检查：只有超管可以修改 is_superuser
        if "is_superuser" in update_data and not current_admin.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only superusers can modify superuser flag",
            )

        if update_data:
            user = await self.user_repo.update_user(user_id, **update_data)

            if not was_active and update_data.get("is_active") is True:
                await self._ensure_default_assistant(user)

            logger.info(
                "admin_updated_user",
                extra={"user_id": str(user_id), "updates": update_data},
            )

        return UserRead(
            id=user.id,
            email=user.email,
            username=user.username,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )

    async def _ensure_default_assistant(self, user: User) -> None:
        if not user.is_active:
            return
        service = DefaultAssistantService(self.db)
        await service.ensure_installed(user.id)

    async def assign_roles(self, user_id: UUID, role_ids: list[UUID]) -> None:
        """分配用户角色"""
        await self._get_user_or_404(user_id)
        await self.user_repo.assign_roles(user_id, role_ids)

        logger.info(
            "admin_role_change",
            extra={
                "user_id": str(user_id),
                "action": "add",
                "role_ids": [str(r) for r in role_ids],
            },
        )

    async def remove_roles(self, user_id: UUID, role_ids: list[UUID]) -> None:
        """移除用户角色"""
        await self._get_user_or_404(user_id)
        await self.user_repo.remove_roles(user_id, role_ids)

        logger.info(
            "admin_role_change",
            extra={
                "user_id": str(user_id),
                "action": "remove",
                "role_ids": [str(r) for r in role_ids],
            },
        )

    async def ban_user(
        self,
        user_id: UUID,
        reason: str,
        duration_hours: int | None = None,
    ) -> str:
        """
        封禁用户

        - 可设置封禁时长（小时），不设置为永久
        - 立即使用户所有 token 失效
        """
        await self._get_user_or_404(user_id)

        await self.auth_service.ban_user(
            user_id=user_id,
            reason=reason,
            duration_hours=duration_hours,
        )

        ban_type = "permanently" if not duration_hours else f"for {duration_hours} hours"
        return f"User banned {ban_type}"

    async def unban_user(self, user_id: UUID) -> None:
        """解封用户"""
        await self._get_user_or_404(user_id)
        await self.auth_service.unban_user(user_id)

    async def list_roles(self) -> list[RoleRead]:
        """获取所有角色"""
        roles = await self.user_repo.get_all_roles()

        return [
            RoleRead(
                id=role.id,
                name=role.name,
                description=role.description,
            )
            for role in roles
        ]

    async def list_permissions(self) -> list[PermissionRead]:
        """获取所有权限"""
        permissions = await self.user_repo.get_all_permissions()

        return [
            PermissionRead(
                id=perm.id,
                code=perm.code,
                description=perm.description,
            )
            for perm in permissions
        ]

    async def _get_user_or_404(self, user_id: UUID) -> User:
        """获取用户，不存在则抛出 404"""
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        return user
