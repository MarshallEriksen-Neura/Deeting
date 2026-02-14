from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.schemas.admin_ops import (
    KnowledgeArtifactAdminItem,
    KnowledgeArtifactAdminListResponse,
)
from app.services.admin import KnowledgeAdminService

router = APIRouter(prefix="/admin/knowledge", tags=["Admin - Knowledge"])


def get_service(db: AsyncSession = Depends(get_db)) -> KnowledgeAdminService:
    return KnowledgeAdminService(db)


@router.get("/artifacts", response_model=KnowledgeArtifactAdminListResponse)
async def list_knowledge_artifacts(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias="status"),
    artifact_type: str | None = Query(default=None),
    q: str | None = Query(default=None, description="标题或 URL 模糊搜索"),
    _=Depends(get_current_superuser),
    service: KnowledgeAdminService = Depends(get_service),
) -> KnowledgeArtifactAdminListResponse:
    return await service.list_artifacts(
        skip=skip,
        limit=limit,
        status_filter=status_filter,
        artifact_type=artifact_type,
        q=q,
    )


@router.get("/artifacts/{artifact_id}", response_model=KnowledgeArtifactAdminItem)
async def get_knowledge_artifact(
    artifact_id: UUID,
    _=Depends(get_current_superuser),
    service: KnowledgeAdminService = Depends(get_service),
) -> KnowledgeArtifactAdminItem:
    return await service.get_artifact(artifact_id)
