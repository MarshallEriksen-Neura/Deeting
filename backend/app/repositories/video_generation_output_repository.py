from __future__ import annotations

from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.video_generation import VideoGenerationOutput


class VideoGenerationOutputRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_by_task(self, task_id) -> list[VideoGenerationOutput]:
        stmt = select(VideoGenerationOutput).where(VideoGenerationOutput.task_id == task_id).order_by(
            VideoGenerationOutput.output_index.asc()
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_by_task_ids(self, task_ids: list) -> list[VideoGenerationOutput]:
        if not task_ids:
            return []
        stmt = (
            select(VideoGenerationOutput)
            .where(VideoGenerationOutput.task_id.in_(task_ids))
            .order_by(VideoGenerationOutput.task_id.asc(), VideoGenerationOutput.output_index.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create(self, payload: dict[str, Any], commit: bool = True) -> VideoGenerationOutput:
        output = VideoGenerationOutput(**payload)
        self.session.add(output)
        if commit:
            await self.session.commit()
            await self.session.refresh(output)
        else:
            await self.session.flush()
        return output

    async def delete_by_task(self, task_id, commit: bool = True) -> None:
        stmt = delete(VideoGenerationOutput).where(VideoGenerationOutput.task_id == task_id)
        await self.session.execute(stmt)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()


__all__ = ["VideoGenerationOutputRepository"]
