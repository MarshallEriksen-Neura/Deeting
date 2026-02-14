from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeArtifact, KnowledgeChunk
from app.schemas.admin_ops import (
    KnowledgeArtifactAdminItem,
    KnowledgeArtifactAdminListResponse,
)


class KnowledgeAdminService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_artifacts(
        self,
        *,
        skip: int,
        limit: int,
        status_filter: str | None = None,
        artifact_type: str | None = None,
        q: str | None = None,
    ) -> KnowledgeArtifactAdminListResponse:
        conditions = []
        if status_filter:
            conditions.append(KnowledgeArtifact.status == status_filter)
        if artifact_type:
            conditions.append(KnowledgeArtifact.artifact_type == artifact_type)
        if q:
            conditions.append(
                or_(
                    KnowledgeArtifact.title.ilike(f"%{q}%"),
                    KnowledgeArtifact.source_url.ilike(f"%{q}%"),
                )
            )

        stmt = select(KnowledgeArtifact)
        count_stmt = select(func.count()).select_from(KnowledgeArtifact)
        if conditions:
            stmt = stmt.where(*conditions)
            count_stmt = count_stmt.where(*conditions)

        stmt = stmt.order_by(
            KnowledgeArtifact.created_at.desc(), KnowledgeArtifact.id.desc()
        ).offset(skip).limit(limit)

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        chunk_counts = await self._chunk_counts([row.id for row in rows])
        items = [
            self._to_item(row, chunk_count=chunk_counts.get(row.id, 0)) for row in rows
        ]
        return KnowledgeArtifactAdminListResponse(
            items=items,
            total=total,
            skip=skip,
            limit=limit,
        )

    async def get_artifact(self, artifact_id: UUID) -> KnowledgeArtifactAdminItem:
        artifact = await self.db.get(KnowledgeArtifact, artifact_id)
        if not artifact:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="knowledge artifact not found",
            )

        chunk_counts = await self._chunk_counts([artifact.id])
        return self._to_item(artifact, chunk_count=chunk_counts.get(artifact.id, 0))

    async def _chunk_counts(self, artifact_ids):
        if not artifact_ids:
            return {}
        stmt = (
            select(KnowledgeChunk.artifact_id, func.count().label("cnt"))
            .where(KnowledgeChunk.artifact_id.in_(artifact_ids))
            .group_by(KnowledgeChunk.artifact_id)
        )
        rows = (await self.db.execute(stmt)).all()
        return {row.artifact_id: int(row.cnt) for row in rows}

    @staticmethod
    def _to_item(
        artifact: KnowledgeArtifact, chunk_count: int
    ) -> KnowledgeArtifactAdminItem:
        return KnowledgeArtifactAdminItem(
            id=artifact.id,
            title=artifact.title,
            source_url=artifact.source_url,
            artifact_type=artifact.artifact_type,
            status=artifact.status,
            embedding_model=artifact.embedding_model,
            content_hash=artifact.content_hash,
            chunk_count=chunk_count,
            created_at=artifact.created_at,
            updated_at=artifact.updated_at,
        )
