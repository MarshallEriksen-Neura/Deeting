from typing import Any, Generic, TypeVar
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.engine import Result
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import Base

ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository(Generic[ModelType]):
    """通用异步 Repository 基类

    现有代码中大部分仓库都会以 `Repo(session)` 的形式初始化，
    因此这里允许通过子类的 `model` 属性自动注入，必要时也可显式传入。
    """

    model: type[ModelType]  # 子类应覆盖

    def __init__(
        self,
        session: AsyncSession,
        model: type[ModelType] | None = None,
    ):
        self.session = session
        self.model = model or getattr(self, "model", None)
        if self.model is None:
            raise ValueError("model must be provided for BaseRepository")

    async def create(self, obj_in: dict[str, Any]) -> ModelType:
        db_obj = self.model(**obj_in)
        self.session.add(db_obj)
        await self.session.commit()
        await self.session.refresh(db_obj)
        return db_obj

    async def get(self, id: UUID) -> ModelType | None:
        result: Result = await self.session.execute(
            select(self.model).where(self.model.id == id)
        )
        return result.scalars().first()

    async def get_multi(self, skip: int = 0, limit: int = 100) -> list[ModelType]:
        result: Result = await self.session.execute(
            select(self.model).offset(skip).limit(limit)
        )
        return list(result.scalars().all())

    async def update(self, db_obj: ModelType, obj_in: dict[str, Any]) -> ModelType:
        for field, value in obj_in.items():
            setattr(db_obj, field, value)

        self.session.add(db_obj)
        await self.session.commit()
        await self.session.refresh(db_obj)
        return db_obj

    async def delete(self, id: UUID) -> ModelType | None:
        obj = await self.get(id)
        if obj:
            await self.session.delete(obj)
            await self.session.commit()
        return obj

    async def count(self) -> int:
        result: Result = await self.session.execute(
            select(func.count()).select_from(self.model)
        )
        return result.scalar() or 0
