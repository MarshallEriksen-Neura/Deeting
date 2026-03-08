from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory_snapshot import MemorySnapshot


class MemorySnapshotRepository:
    """Repository for memory audit trail snapshots."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        memory_point_id: str,
        action: str,
        old_content: str | None = None,
        new_content: str | None = None,
        old_metadata: dict | None = None,
        new_metadata: dict | None = None,
    ) -> MemorySnapshot:
        snapshot = MemorySnapshot(
            user_id=user_id,
            memory_point_id=memory_point_id,
            action=action,
            old_content=old_content,
            new_content=new_content,
            old_metadata=old_metadata,
            new_metadata=new_metadata,
        )
        self.session.add(snapshot)
        await self.session.flush()
        return snapshot

    async def list_by_memory(
        self,
        user_id: uuid.UUID,
        memory_point_id: str,
        limit: int = 20,
    ) -> list[MemorySnapshot]:
        stmt = (
            select(MemorySnapshot)
            .where(
                MemorySnapshot.user_id == user_id,
                MemorySnapshot.memory_point_id == memory_point_id,
            )
            .order_by(MemorySnapshot.created_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id(
        self,
        snapshot_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> MemorySnapshot | None:
        stmt = select(MemorySnapshot).where(
            MemorySnapshot.id == snapshot_id,
            MemorySnapshot.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
