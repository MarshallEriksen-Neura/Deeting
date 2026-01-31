from typing import Any, Dict, Optional, List
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, HttpUrl
from sqlalchemy import select

from app.deps.auth import get_current_active_superuser
from app.core.database import AsyncSessionLocal
from app.repositories.knowledge_repository import KnowledgeRepository
from app.services.knowledge.crawler_knowledge_service import CrawlerKnowledgeService
from app.models.knowledge import KnowledgeArtifact

router = APIRouter()

class DeepDiveRequest(BaseModel):
    url: HttpUrl
    max_depth: int = 2
    max_pages: int = 10
    artifact_type: str = "documentation"
    
    # Optional Dynamic Embedding Config (Billing Only)
    embedding_api_key: Optional[str] = None
    embedding_base_url: Optional[str] = None

class ReviewItem(BaseModel):
    id: uuid.UUID
    url: str
    title: str | None
    status: str
    created_at: Any

@router.post("/ingest/deep-dive", response_model=Dict[str, Any])
async def ingest_deep_dive(
    request: DeepDiveRequest,
    current_user: Any = Depends(get_current_active_superuser),
) -> Any:
    """
    Start a Deep Dive ingestion process.
    Content will be placed in 'pending_review' state.
    """
    embedding_config = {}
    if request.embedding_api_key:
        embedding_config["api_key"] = request.embedding_api_key
    if request.embedding_base_url:
        embedding_config["base_url"] = request.embedding_base_url
        
    async with AsyncSessionLocal() as session:
        repo = KnowledgeRepository(session)
        service = CrawlerKnowledgeService(repo)
        
        try:
            result = await service.ingest_deep_dive(
                str(request.url),
                max_depth=request.max_depth,
                max_pages=request.max_pages,
                artifact_type=request.artifact_type,
                embedding_config=embedding_config if embedding_config else None
            )
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

@router.get("/ingest/reviews", response_model=List[ReviewItem])
async def list_pending_reviews(
    current_user: Any = Depends(get_current_active_superuser),
):
    """List all artifacts waiting for review."""
    async with AsyncSessionLocal() as session:
        # Direct query for MVP, ideally moving to Repository
        stmt = select(KnowledgeArtifact).where(KnowledgeArtifact.status == "pending_review").order_by(KnowledgeArtifact.created_at.desc())
        result = await session.execute(stmt)
        items = result.scalars().all()
        return [
            ReviewItem(
                id=item.id,
                url=item.source_url,
                title=item.title,
                status=item.status,
                created_at=item.created_at
            )
            for item in items
        ]

@router.post("/ingest/reviews/{artifact_id}/approve")
async def approve_artifact(
    artifact_id: uuid.UUID,
    current_user: Any = Depends(get_current_active_superuser),
):
    """Approve artifact -> Trigger Indexing."""
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