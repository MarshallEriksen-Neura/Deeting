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
from app.services.oss.asset_storage_service import (
    build_public_asset_url,
    build_signed_asset_url,
)


class UserService:
    """用户自助服务"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)

    def _build_avatar_url(self, user: User) -> str | None:
        """根据用户头像存储类型构建访问 URL"""
        if not user.avatar_object_key:
            return None
        
        if user.avatar_storage_type == "public":
            return build_public_asset_url(user.avatar_object_key)
        else:
            # 私有桶使用签名 URL（这里使用默认 base_url）
            return build_signed_asset_url(user.avatar_object_key)

    async def update_profile(self, user: User, request: UserUpdate) -> UserRead:
        """
        更新用户个人信息

        - 只更新提供的字段
        - 如果更新头像，自动设置 storage_type 为 public
        - 返回更新后的用户信息
        """
        update_data = request.model_dump(exclude_unset=True)

        # 如果更新头像 object_key，自动设置 storage_type
        if "avatar_object_key" in update_data and update_data["avatar_object_key"]:
            update_data["avatar_storage_type"] = update_data.get("avatar_storage_type", "public")

        if update_data:
            user = await self.user_repo.update_user(user.id, **update_data)
            logger.info("user_profile_updated", extra={"user_id": str(user.id)})

        return UserRead(
            id=user.id,
            email=user.email,
            username=user.username,
            avatar_url=self._build_avatar_url(user),
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )
