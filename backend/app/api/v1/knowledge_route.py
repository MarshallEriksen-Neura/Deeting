import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.deps.auth import get_current_active_superuser
from app.models.knowledge import KnowledgeArtifact
from app.repositories.knowledge_repository import KnowledgeRepository
from app.services.knowledge.crawler_knowledge_service import CrawlerKnowledgeService

router = APIRouter()


class ReviewItem(BaseModel):
    id: uuid.UUID
    url: str
    title: str | None
    status: str
    created_at: Any


@router.get("/ingest/reviews", response_model=list[ReviewItem])
async def list_pending_reviews(
    current_user: Any = Depends(get_current_active_superuser),
):
    """List all artifacts waiting for review."""
    async with AsyncSessionLocal() as session:
        stmt = (
            select(KnowledgeArtifact)
            .where(KnowledgeArtifact.status == "pending_review")
            .order_by(KnowledgeArtifact.created_at.desc())
        )
        result = await session.execute(stmt)
        items = result.scalars().all()
        return [
            ReviewItem(
                id=item.id,
                url=item.source_url,
                title=item.title,
                status=item.status,
                created_at=item.created_at,
            )
            for item in items
        ]


@router.post("/ingest/reviews/{artifact_id}/approve")
async def approve_artifact(
    artifact_id: uuid.UUID,
    current_user: Any = Depends(get_current_active_superuser),
):
    """Approve artifact -> Trigger Indexing (RAG)."""
    async with AsyncSessionLocal() as session:
        repo = KnowledgeRepository(session)
        service = CrawlerKnowledgeService(repo)
        try:
            await service.approve_artifact(artifact_id)
            await session.commit()
            return {"status": "approved"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.post("/ingest/reviews/{artifact_id}/reject")
async def reject_artifact(
    artifact_id: uuid.UUID,
    current_user: Any = Depends(get_current_active_superuser),
):
    """Reject artifact -> Delete."""
    async with AsyncSessionLocal() as session:
        repo = KnowledgeRepository(session)
        service = CrawlerKnowledgeService(repo)
        try:
            await service.reject_artifact(artifact_id)
            await session.commit()
            return {"status": "rejected"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
