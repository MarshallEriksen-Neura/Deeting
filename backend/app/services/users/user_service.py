"""
用户自助服务：用户个人信息管理

遵循 AGENTS.md 最佳实践:
- Service 负责业务逻辑，不在路由中直接操作 ORM/Repository
- 业务异常在 Service 内抛出 HTTPException
- 统一日志字段方便审计
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models import User
from app.repositories import UserRepository
from app.schemas.user import UserRead, UserUpdate


class UserService:
    """用户自助服务"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)

    async def update_profile(self, user: User, request: UserUpdate) -> UserRead:
        """
        更新用户个人信息

        - 只更新提供的字段
        - 返回更新后的用户信息
        """
        update_data = request.model_dump(exclude_unset=True)

        if update_data:
            user = await self.user_repo.update_user(user.id, **update_data)
            logger.info("user_profile_updated", extra={"user_id": str(user.id)})

        return UserRead(
            id=user.id,
            email=user.email,
            username=user.username,
            avatar_url=user.avatar_url,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )
