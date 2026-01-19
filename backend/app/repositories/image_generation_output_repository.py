from __future__ import annotations

from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_generation import ImageGenerationOutput


class ImageGenerationOutputRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_by_task(self, task_id) -> list[ImageGenerationOutput]:
        stmt = select(ImageGenerationOutput).where(ImageGenerationOutput.task_id == task_id).order_by(
            ImageGenerationOutput.output_index.asc()
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create(self, payload: dict[str, Any], commit: bool = True) -> ImageGenerationOutput:
        output = ImageGenerationOutput(**payload)
        self.session.add(output)
        if commit:
            await self.session.commit()
            await self.session.refresh(output)
        else:
            await self.session.flush()
        return output

    async def delete_by_task(self, task_id, commit: bool = True) -> None:
        stmt = delete(ImageGenerationOutput).where(ImageGenerationOutput.task_id == task_id)
        await self.session.execute(stmt)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()


__all__ = ["ImageGenerationOutputRepository"]
