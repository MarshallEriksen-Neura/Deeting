from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Permission, Role, RolePermission, User, UserRole
from app.models.identity import Identity


class UserRepository:
    """
    用户及权限相关的仓库封装，避免在业务层直接写 SQL/ORM。
    """

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, user_id: UUID) -> User | None:
        return await self.session.get(User, user_id)

    async def get_by_identity(self, provider: str, external_id: str) -> User | None:
        stmt = (
            select(User)
            .join(Identity, Identity.user_id == User.id)
            .where(Identity.provider == provider, Identity.external_id == external_id)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def permission_codes(self, user_id: UUID) -> set[str]:
        stmt = (
            select(Permission.code)
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .join(RolePermission, RolePermission.role_id == Role.id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(UserRole.user_id == user_id)
        )
        res = await self.session.execute(stmt)
        return set(res.scalars().all())

    async def get_by_email(self, email: str) -> User | None:
        """根据邮箱查询用户"""
        stmt = select(User).where(User.email == email)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_primary_superuser(self) -> User | None:
        """获取首个超级用户（作为系统默认审核人）"""
        stmt = (
            select(User)
            .where(User.is_superuser.is_(True))
            .order_by(User.created_at.asc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_user(
        self,
        email: str,
        hashed_password: str,
        username: str | None = None,
        avatar_url: str | None = None,
        is_active: bool = False,
    ) -> User:
        """创建新用户。密码为空时由上层保证已提供占位哈希。"""
        user = User(
            email=email,
            hashed_password=hashed_password,
            username=username,
            avatar_url=avatar_url,
            is_active=is_active,
        )
        self.session.add(user)
        await self.session.flush()
        await self.session.refresh(user)
        return user

    async def update_password(self, user_id: UUID, hashed_password: str) -> User | None:
        """更新用户密码"""
        user = await self.get_by_id(user_id)
        if user:
            user.hashed_password = hashed_password
            user.token_version += 1
            await self.session.flush()
            await self.session.refresh(user)
        return user

    async def update_user(self, user_id: UUID, **fields) -> User | None:
        """更新用户字段"""
        user = await self.get_by_id(user_id)
        if user:
            for key, value in fields.items():
                if hasattr(user, key) and value is not None:
                    setattr(user, key, value)
            await self.session.flush()
            await self.session.refresh(user)
        return user

    async def activate_user(self, user_id: UUID) -> User | None:
        """激活用户账号"""
        return await self.update_user(user_id, is_active=True)

    async def increment_token_version(self, user_id: UUID) -> int:
        """递增 token 版本号（用于强制登出）"""
        stmt = (
            update(User)
            .where(User.id == user_id)
            .values(token_version=User.token_version + 1)
            .returning(User.token_version)
        )
        result = await self.session.execute(stmt)
        await self.session.flush()
        version = result.scalar_one_or_none()
        return version if version is not None else 0

    async def list_users(
        self,
        skip: int = 0,
        limit: int = 20,
        email_filter: str | None = None,
        is_active: bool | None = None,
        is_superuser: bool | None = None,
    ) -> tuple[list[User], int]:
        """分页查询用户列表，支持邮箱模糊、激活状态、超管筛选"""
        conditions = []
        if email_filter:
            conditions.append(User.email.ilike(f"%{email_filter}%"))
        if is_active is not None:
            conditions.append(User.is_active == is_active)
        if is_superuser is not None:
            conditions.append(User.is_superuser == is_superuser)

        count_stmt = select(func.count(User.id))
        if conditions:
            count_stmt = count_stmt.where(*conditions)
        total = (await self.session.execute(count_stmt)).scalar() or 0

        list_stmt = select(User).order_by(User.created_at.desc()).offset(skip).limit(limit)
        if conditions:
            list_stmt = list_stmt.where(*conditions)
        result = await self.session.execute(list_stmt)
        users = list(result.scalars().all())

        return users, total

    async def get_user_with_roles(self, user_id: UUID) -> User | None:
        """获取用户及其角色"""
        stmt = select(User).where(User.id == user_id).options(selectinload(User.roles))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def assign_roles(self, user_id: UUID, role_ids: list[UUID]) -> None:
        """为用户分配角色（去重，避免违反唯一约束）"""
        # 查询已存在的角色
        stmt = select(UserRole.role_id).where(UserRole.user_id == user_id)
        existing = set((await self.session.execute(stmt)).scalars().all())

        for role_id in role_ids:
            if role_id in existing:
                continue
            user_role = UserRole(user_id=user_id, role_id=role_id)
            self.session.add(user_role)
        await self.session.flush()

    async def remove_roles(self, user_id: UUID, role_ids: list[UUID]) -> None:
        """移除用户角色"""
        stmt = delete(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id.in_(role_ids)
        )
        await self.session.execute(stmt)
        await self.session.flush()

    async def get_all_roles(self) -> list[Role]:
        """获取所有角色"""
        stmt = select(Role).order_by(Role.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_role_by_name(self, name: str) -> Role | None:
        """根据角色名获取角色"""
        stmt = select(Role).where(Role.name == name)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_all_permissions(self) -> list[Permission]:
        """获取所有权限"""
        stmt = select(Permission).order_by(Permission.code)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
