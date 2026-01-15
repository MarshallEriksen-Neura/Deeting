from __future__ import annotations

from uuid import UUID

from app.models.assistant import Assistant
from app.repositories.assistant_install_repository import AssistantInstallRepository
from app.repositories.assistant_rating_repository import AssistantRatingRepository
from app.repositories.assistant_repository import AssistantRepository


class AssistantRatingService:
    def __init__(
        self,
        assistant_repo: AssistantRepository,
        install_repo: AssistantInstallRepository,
        rating_repo: AssistantRatingRepository,
    ):
        self.assistant_repo = assistant_repo
        self.install_repo = install_repo
        self.rating_repo = rating_repo

    async def rate_assistant(self, *, user_id: UUID, assistant_id: UUID, rating: float) -> Assistant:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            raise ValueError("助手不存在")

        install = await self.install_repo.get_by_user_and_assistant(user_id, assistant_id)
        if not install:
            raise ValueError("请先安装助手后再评分")

        existing = await self.rating_repo.get_by_user_and_assistant(user_id, assistant_id)
        if existing:
            old = float(existing.rating)
            if old == float(rating):
                return assistant
            await self.rating_repo.update(existing, {"rating": float(rating)})
            count = int(assistant.rating_count or 0)
            if count <= 0:
                refreshed = await self.refresh_rating(assistant_id)
                return refreshed or assistant
            avg = float(assistant.rating_avg or 0.0)
            new_avg = (avg * count - old + float(rating)) / count
            await self.assistant_repo.update(
                assistant,
                {
                    "rating_avg": float(round(new_avg, 4)),
                },
            )
            return assistant

        await self.rating_repo.create(
            {
                "user_id": user_id,
                "assistant_id": assistant_id,
                "rating": float(rating),
            }
        )
        count = int(assistant.rating_count or 0)
        avg = float(assistant.rating_avg or 0.0)
        new_count = count + 1
        new_avg = (avg * count + float(rating)) / new_count
        await self.assistant_repo.update(
            assistant,
            {
                "rating_count": new_count,
                "rating_avg": float(round(new_avg, 4)),
            },
        )
        return assistant

    async def refresh_rating(self, assistant_id: UUID) -> Assistant | None:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            return None
        avg, count = await self.rating_repo.aggregate_by_assistant(assistant_id)
        await self.assistant_repo.update(
            assistant,
            {"rating_avg": float(round(avg, 4)), "rating_count": count},
        )
        return assistant
