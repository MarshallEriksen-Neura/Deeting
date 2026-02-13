from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge_folder import KnowledgeFolder


class KnowledgeFolderRepository:
    """用户知识库文件夹仓库。"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, folder_id: UUID) -> KnowledgeFolder | None:
        return await self.session.get(KnowledgeFolder, folder_id)

    async def get_owned(self, folder_id: UUID, user_id: UUID) -> KnowledgeFolder | None:
        stmt = select(KnowledgeFolder).where(
            KnowledgeFolder.id == folder_id,
            KnowledgeFolder.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_parent(
        self,
        *,
        user_id: UUID,
        parent_id: UUID | None,
    ) -> list[KnowledgeFolder]:
        stmt = select(KnowledgeFolder).where(KnowledgeFolder.user_id == user_id)
        if parent_id is None:
            stmt = stmt.where(KnowledgeFolder.parent_id.is_(None))
        else:
            stmt = stmt.where(KnowledgeFolder.parent_id == parent_id)
        stmt = stmt.order_by(KnowledgeFolder.created_at.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_by_parent_ids(
        self,
        *,
        user_id: UUID,
        parent_ids: list[UUID],
    ) -> list[KnowledgeFolder]:
        if not parent_ids:
            return []
        stmt = select(KnowledgeFolder).where(
            KnowledgeFolder.user_id == user_id,
            KnowledgeFolder.parent_id.in_(parent_ids),
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def exists_name(
        self,
        *,
        user_id: UUID,
        parent_id: UUID | None,
        name: str,
        exclude_id: UUID | None = None,
    ) -> bool:
        stmt = select(KnowledgeFolder.id).where(
            KnowledgeFolder.user_id == user_id,
            KnowledgeFolder.name == name,
        )
        if parent_id is None:
            stmt = stmt.where(KnowledgeFolder.parent_id.is_(None))
        else:
            stmt = stmt.where(KnowledgeFolder.parent_id == parent_id)
        if exclude_id is not None:
            stmt = stmt.where(KnowledgeFolder.id != exclude_id)
        result = await self.session.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def create(
        self,
        *,
        user_id: UUID,
        name: str,
        parent_id: UUID | None,
    ) -> KnowledgeFolder:
        folder = KnowledgeFolder(user_id=user_id, name=name, parent_id=parent_id)
        self.session.add(folder)
        await self.session.flush()
        await self.session.refresh(folder)
        return folder

    async def count_by_user(self, *, user_id: UUID) -> int:
        stmt = select(func.count(KnowledgeFolder.id)).where(KnowledgeFolder.user_id == user_id)
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def has_children(self, *, folder_id: UUID, user_id: UUID) -> bool:
        stmt = select(KnowledgeFolder.id).where(
            KnowledgeFolder.user_id == user_id,
            KnowledgeFolder.parent_id == folder_id,
        )
        result = await self.session.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def delete(self, folder: KnowledgeFolder) -> None:
        await self.session.delete(folder)
        await self.session.flush()


__all__ = ["KnowledgeFolderRepository"]
