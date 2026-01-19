from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_generation import ImageGenerationStatus, ImageGenerationTask


class ImageGenerationTaskRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, task_id) -> ImageGenerationTask | None:
        return await self.session.get(ImageGenerationTask, task_id)

    async def get_by_request_id(
        self,
        *,
        user_id,
        request_id: str,
    ) -> ImageGenerationTask | None:
        stmt = select(ImageGenerationTask).where(
            ImageGenerationTask.user_id == user_id,
            ImageGenerationTask.request_id == request_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    def build_user_query(
        self,
        *,
        user_id,
        status: ImageGenerationStatus | None = None,
        session_id=None,
    ):
        stmt = (
            select(ImageGenerationTask)
            .where(ImageGenerationTask.user_id == user_id)
            .order_by(ImageGenerationTask.created_at.desc(), ImageGenerationTask.id.desc())
        )
        if status:
            stmt = stmt.where(ImageGenerationTask.status == status)
        if session_id:
            stmt = stmt.where(ImageGenerationTask.session_id == session_id)
        return stmt

    async def create(self, payload: dict[str, Any], commit: bool = True) -> ImageGenerationTask:
        task = ImageGenerationTask(**payload)
        self.session.add(task)
        if commit:
            await self.session.commit()
            await self.session.refresh(task)
        else:
            await self.session.flush()
        return task

    async def update_status(
        self,
        task_id,
        *,
        status: ImageGenerationStatus,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        commit: bool = True,
    ) -> None:
        values: dict[str, Any] = {
            "status": status,
        }
        if started_at is not None:
            values["started_at"] = started_at
        if completed_at is not None:
            values["completed_at"] = completed_at
        if error_code is not None:
            values["error_code"] = error_code
        if error_message is not None:
            values["error_message"] = error_message

        stmt = update(ImageGenerationTask).where(ImageGenerationTask.id == task_id).values(**values)
        await self.session.execute(stmt)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()

    async def update_fields(self, task_id, payload: dict[str, Any], commit: bool = True) -> None:
        if not payload:
            return
        stmt = update(ImageGenerationTask).where(ImageGenerationTask.id == task_id).values(**payload)
        await self.session.execute(stmt)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()


__all__ = ["ImageGenerationTaskRepository"]
