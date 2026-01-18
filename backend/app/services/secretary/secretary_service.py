from __future__ import annotations

from uuid import UUID

from app.repositories import ProviderModelRepository, UserSecretaryRepository


class UserSecretaryService:
    def __init__(
        self,
        secretary_repo: UserSecretaryRepository,
        model_repo: ProviderModelRepository,
    ):
        self.secretary_repo = secretary_repo
        self.model_repo = model_repo

    async def get_or_create(self, user_id: UUID):
        secretary = await self.secretary_repo.get_by_user_id(user_id)
        if secretary:
            return secretary
        return await self.secretary_repo.create(
            {
                "user_id": user_id,
                "name": "deeting",
            }
        )

    async def update_model(self, *, user_id: UUID, model_name: str):
        return await self.update_settings(user_id=user_id, model_name=model_name)

    async def update_settings(
        self,
        *,
        user_id: UUID,
        model_name: str | None = None,
    ):
        if model_name is None:
            raise ValueError("请至少提供一个可更新字段")

        if not model_name:
            raise ValueError("秘书模型不能为空")
        candidates = await self.model_repo.get_candidates(
            capability="chat",
            model_id=model_name,
            user_id=str(user_id),
            include_public=True,
        )
        if not candidates:
            raise ValueError("模型不可用或无权限")

        secretary = await self.get_or_create(user_id)
        return await self.secretary_repo.update(secretary, {"model_name": model_name})
