from typing import List, Optional
import uuid
from sqlalchemy import select
from app.repositories.base import BaseRepository
from app.models.knowledge import KnowledgeArtifact, KnowledgeChunk

class KnowledgeRepository(BaseRepository):
    """
    Repository for KnowledgeArtifact and KnowledgeChunk.
    """
    
    async def get_artifact_by_url(self, url: str) -> Optional[KnowledgeArtifact]:
        stmt = select(KnowledgeArtifact).where(KnowledgeArtifact.source_url == url)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_artifact_with_chunks(self, artifact_id: uuid.UUID) -> Optional[KnowledgeArtifact]:
        stmt = select(KnowledgeArtifact).where(KnowledgeArtifact.id == artifact_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_chunks_by_artifact(self, artifact_id: uuid.UUID) -> List[KnowledgeChunk]:
        stmt = select(KnowledgeChunk).where(KnowledgeChunk.artifact_id == artifact_id).order_by(KnowledgeChunk.chunk_index)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create_artifact(self, data: dict) -> KnowledgeArtifact:
        artifact = KnowledgeArtifact(**data)
        self.session.add(artifact)
        await self.session.flush()
        return artifact

    async def create_chunk(self, data: dict) -> KnowledgeChunk:
        chunk = KnowledgeChunk(**data)
        self.session.add(chunk)
        await self.session.flush()
        return chunk
    
    async def delete_chunks_by_artifact(self, artifact_id: uuid.UUID):
        from sqlalchemy import delete
        stmt = delete(KnowledgeChunk).where(KnowledgeChunk.artifact_id == artifact_id)
        await self.session.execute(stmt)
