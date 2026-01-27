from __future__ import annotations

from typing import Optional

from sqlalchemy import select

from app.models.spec_knowledge import SpecKnowledgeCandidate
from app.repositories.base import BaseRepository


class SpecKnowledgeCandidateRepository(BaseRepository[SpecKnowledgeCandidate]):
    model = SpecKnowledgeCandidate

    async def get_by_hash(self, canonical_hash: str) -> SpecKnowledgeCandidate | None:
        stmt = select(SpecKnowledgeCandidate).where(
            SpecKnowledgeCandidate.canonical_hash == canonical_hash
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    def build_query(
        self,
        *,
        status: Optional[str] = None,
    ):
        stmt = select(SpecKnowledgeCandidate)
        if status:
            stmt = stmt.where(SpecKnowledgeCandidate.status == status)
        return stmt.order_by(
            SpecKnowledgeCandidate.created_at.desc(), SpecKnowledgeCandidate.id.desc()
        )


__all__ = ["SpecKnowledgeCandidateRepository"]
