from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import settings
from app.deps.auth import get_current_active_user
from app.models import User
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.schemas.memory import MemoryItem, MemoryListResponse, MemoryUpdateRequest
from app.services.vector.qdrant_user_service import QdrantUserVectorService

router = APIRouter(prefix="/memory", tags=["User Memory"])


async def get_memory_service(
    current_user: User = Depends(get_current_active_user),
) -> QdrantUserVectorService:
    """
    Dependency to get the QdrantUserVectorService for the current user.
    """
    if not qdrant_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Memory service (Qdrant) is not configured.",
        )

    client = get_qdrant_client()
    return QdrantUserVectorService(
        client=client,
        user_id=current_user.id,
        plugin_id=None,  # Access all user memories regardless of plugin
        embedding_model=getattr(settings, "EMBEDDING_MODEL", None),
        fail_open=False,  # We want errors in the management API
    )


@router.get("", response_model=MemoryListResponse)
async def list_memories(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None, description="Pagination cursor"),
    service: QdrantUserVectorService = Depends(get_memory_service),
):
    """
    List user's memory entries (paginated).
    """
    items, next_cursor = await service.list_points(limit=limit, cursor=cursor)
    return MemoryListResponse(
        items=[MemoryItem(**item) for item in items],
        next_cursor=next_cursor,
    )


@router.patch("/{memory_id}", response_model=MemoryItem)
async def update_memory(
    memory_id: str,
    request: MemoryUpdateRequest,
    service: QdrantUserVectorService = Depends(get_memory_service),
):
    """
    Update a specific memory entry's content.
    This will re-embed the content and update the vector store.
    """
    # Note: upsert in QdrantUserVectorService handles re-embedding
    # We might want to verify it exists first, but scroll/search can do that.
    # For now, we just perform the upsert.
    await service.upsert(content=request.content, id=memory_id)

    return MemoryItem(id=memory_id, content=request.content)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: str,
    service: QdrantUserVectorService = Depends(get_memory_service),
):
    """
    Delete a specific memory entry.
    """
    await service.delete(ids=[memory_id])
    return None


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_memories(
    service: QdrantUserVectorService = Depends(get_memory_service),
):
    """
    Clear ALL user memories.
    """
    await service.clear_all()
    return None
