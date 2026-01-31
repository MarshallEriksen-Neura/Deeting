from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, HttpUrl

from app.deps.auth import get_current_active_superuser
from app.core.database import AsyncSessionLocal
from app.repositories.knowledge_repository import KnowledgeRepository
from app.services.knowledge.crawler_knowledge_service import CrawlerKnowledgeService

router = APIRouter()

class DeepDiveRequest(BaseModel):
    url: HttpUrl
    max_depth: int = 2
    max_pages: int = 10
    artifact_type: str = "documentation"
    
    # Optional Dynamic Embedding Config (Billing Only)
    embedding_api_key: Optional[str] = None
    embedding_base_url: Optional[str] = None

@router.post("/ingest/deep-dive", response_model=Dict[str, Any])
async def ingest_deep_dive(
    request: DeepDiveRequest,
    current_user: Any = Depends(get_current_active_superuser),
) -> Any:
    """
    Start a Deep Dive ingestion process.
    This is an atomic capability. Intelligent discovery should be handled by Agents/Plugins.
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
