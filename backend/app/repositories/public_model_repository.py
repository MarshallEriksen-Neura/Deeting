
from sqlalchemy import select

from app.models.public_model import PublicModel

from .base import BaseRepository


class PublicModelRepository(BaseRepository[PublicModel]):
    model = PublicModel

    async def get_by_model_id(self, model_id: str) -> PublicModel | None:
        result = await self.session.execute(
            select(PublicModel).where(PublicModel.model_id == model_id)
        )
        return result.scalars().first()
