from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, HttpUrl

from app.api import deps
from app.core.database import AsyncSessionLocal
from app.repositories.knowledge_repository import KnowledgeRepository
from app.services.knowledge.crawler_knowledge_service import CrawlerKnowledgeService

router = APIRouter()

class DeepDiveRequest(BaseModel):
    url: HttpUrl
    max_depth: int = 2
    max_pages: int = 10
    artifact_type: str = "documentation"

@router.post("/ingest/deep-dive", response_model=Dict[str, Any])
async def ingest_deep_dive(
    request: DeepDiveRequest,
    current_user: Any = Depends(deps.get_current_active_superuser), # Admin only
) -> Any:
    """
    Start a Deep Dive ingestion process.
    """
    async with AsyncSessionLocal() as session:
        repo = KnowledgeRepository(session)
        service = CrawlerKnowledgeService(repo)
        
        try:
            result = await service.ingest_deep_dive(
                str(request.url),
                max_depth=request.max_depth,
                max_pages=request.max_pages,
                artifact_type=request.artifact_type
            )
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
