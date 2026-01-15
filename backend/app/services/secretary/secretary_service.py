from __future__ import annotations

from uuid import UUID

from app.repositories import (
    ProviderModelRepository,
    SecretaryPhaseRepository,
    UserSecretaryRepository,
)


class UserSecretaryService:
    def __init__(
        self,
        secretary_repo: UserSecretaryRepository,
        phase_repo: SecretaryPhaseRepository,
        model_repo: ProviderModelRepository,
    ):
        self.secretary_repo = secretary_repo
        self.phase_repo = phase_repo
        self.model_repo = model_repo

    async def get_or_create(self, user_id: UUID):
        secretary = await self.secretary_repo.get_by_user_id(user_id)
        if secretary:
            return secretary
        phase = await self.phase_repo.get_default()
        if not phase:
            raise ValueError("未配置秘书阶段")
        return await self.secretary_repo.create(
            {
                "user_id": user_id,
                "current_phase_id": phase.id,
                "name": "My Secretary",
            }
        )

    async def update_model(self, *, user_id: UUID, model_name: str):
        if not model_name:
            raise ValueError("秘书模型不能为空")
        candidates = await self.model_repo.get_candidates(
            capability="chat",
            model_id=model_name,
            user_id=str(user_id),
            include_public=False,
        )
        if not candidates:
            raise ValueError("模型不可用或不属于当前用户")
        secretary = await self.get_or_create(user_id)
        return await self.secretary_repo.update(secretary, {"model_name": model_name})
