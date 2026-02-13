from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.media_asset import MediaAsset
from app.models.user_document import UserDocument


class UserDocumentRepository:
    """用户知识库文档仓库。"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, doc_id: UUID) -> UserDocument | None:
        stmt = (
            select(UserDocument)
            .where(UserDocument.id == doc_id)
            .options(selectinload(UserDocument.media_asset))
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_owned(self, *, doc_id: UUID, user_id: UUID) -> UserDocument | None:
        stmt = (
            select(UserDocument)
            .where(UserDocument.id == doc_id, UserDocument.user_id == user_id)
            .options(selectinload(UserDocument.media_asset))
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_owned_by_ids(
        self,
        *,
        user_id: UUID,
        doc_ids: list[UUID],
    ) -> list[UserDocument]:
        if not doc_ids:
            return []
        stmt = (
            select(UserDocument)
            .where(
                UserDocument.user_id == user_id,
                UserDocument.id.in_(doc_ids),
            )
            .options(selectinload(UserDocument.media_asset))
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_by_folder(
        self,
        *,
        user_id: UUID,
        folder_id: UUID | None,
    ) -> list[UserDocument]:
        stmt = (
            select(UserDocument)
            .where(UserDocument.user_id == user_id)
            .options(selectinload(UserDocument.media_asset))
        )
        if folder_id is None:
            stmt = stmt.where(UserDocument.folder_id.is_(None))
        else:
            stmt = stmt.where(UserDocument.folder_id == folder_id)
        stmt = stmt.order_by(UserDocument.created_at.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_by_folder_ids(
        self,
        *,
        user_id: UUID,
        folder_ids: list[UUID],
    ) -> list[UserDocument]:
        if not folder_ids:
            return []
        stmt = (
            select(UserDocument)
            .where(
                UserDocument.user_id == user_id,
                UserDocument.folder_id.in_(folder_ids),
            )
            .options(selectinload(UserDocument.media_asset))
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_by_folder(self, *, user_id: UUID, folder_id: UUID) -> int:
        stmt = select(func.count(UserDocument.id)).where(
            UserDocument.user_id == user_id,
            UserDocument.folder_id == folder_id,
        )
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def count_by_folder_ids(
        self,
        *,
        user_id: UUID,
        folder_ids: list[UUID],
    ) -> dict[UUID, int]:
        if not folder_ids:
            return {}
        stmt = (
            select(UserDocument.folder_id, func.count(UserDocument.id))
            .where(
                UserDocument.user_id == user_id,
                UserDocument.folder_id.in_(folder_ids),
            )
            .group_by(UserDocument.folder_id)
        )
        result = await self.session.execute(stmt)
        counts: dict[UUID, int] = {}
        for folder_id, count in result.all():
            if folder_id is not None:
                counts[folder_id] = int(count or 0)
        return counts

    async def create(
        self,
        *,
        user_id: UUID,
        media_asset_id: UUID,
        filename: str,
        folder_id: UUID | None,
        status: str,
        meta_info: dict,
    ) -> UserDocument:
        doc = UserDocument(
            user_id=user_id,
            media_asset_id=media_asset_id,
            filename=filename,
            folder_id=folder_id,
            status=status,
            meta_info=meta_info,
        )
        self.session.add(doc)
        await self.session.flush()
        await self.session.refresh(doc)
        return doc

    async def update(self, doc: UserDocument, **fields) -> UserDocument:
        for key, value in fields.items():
            setattr(doc, key, value)
        self.session.add(doc)
        await self.session.flush()
        await self.session.refresh(doc)
        return doc

    async def delete(self, doc: UserDocument) -> None:
        await self.session.delete(doc)
        await self.session.flush()

    async def count_by_user(self, *, user_id: UUID) -> int:
        stmt = select(func.count(UserDocument.id)).where(UserDocument.user_id == user_id)
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def sum_chunks_by_user(self, *, user_id: UUID) -> int:
        stmt = select(func.coalesce(func.sum(UserDocument.chunk_count), 0)).where(
            UserDocument.user_id == user_id
        )
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def sum_size_bytes_by_user(self, *, user_id: UUID) -> int:
        stmt = (
            select(func.coalesce(func.sum(MediaAsset.size_bytes), 0))
            .select_from(UserDocument)
            .join(MediaAsset, MediaAsset.id == UserDocument.media_asset_id)
            .where(UserDocument.user_id == user_id)
        )
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)


__all__ = ["UserDocumentRepository"]
