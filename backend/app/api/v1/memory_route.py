from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user
from app.models import User
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.memory_snapshot_repository import MemorySnapshotRepository
from app.schemas.memory import (
    MemoryItem,
    MemoryListResponse,
    MemoryRollbackRequest,
    MemoryRollbackResponse,
    MemorySnapshotItem,
    MemorySnapshotListResponse,
    MemoryUpdateRequest,
)
from app.services.memory.external_memory import search_user_memories
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
        embedding_model=None,
        enforce_embedding_model_scope=False,
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


@router.get("/search", response_model=list[MemoryItem])
async def search_memories(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(5, ge=1, le=50),
    current_user: User = Depends(get_current_active_user),
):
    """
    Semantic memory search with vitality-aware reranking.
    Over-fetches 3x, applies vitality decay rerank, returns top-K.
    """
    results = await search_user_memories(
        user_id=current_user.id,
        query=q,
        limit=limit,
    )
    return [
        MemoryItem(
            id=r.get("id", ""),
            content=r.get("content", ""),
            payload=r.get("payload", {}),
            score=r.get("final_score"),
        )
        for r in results
    ]


@router.patch("/{memory_id}", response_model=MemoryItem)
async def update_memory(
    memory_id: str,
    request: MemoryUpdateRequest,
    service: QdrantUserVectorService = Depends(get_memory_service),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a specific memory entry's content.
    This will re-embed the content and update the vector store.
    Records a snapshot for audit trail before updating.
    """
    # Fetch current content for snapshot
    old_content = None
    try:
        results = await service.search(memory_id, limit=1)
        if results:
            old_content = results[0].get("content")
    except Exception:
        pass  # Best-effort: snapshot without old_content if fetch fails

    # Record snapshot
    repo = MemorySnapshotRepository(db)
    await repo.create(
        user_id=current_user.id,
        memory_point_id=memory_id,
        action="update",
        old_content=old_content,
        new_content=request.content,
    )
    await db.commit()

    await service.upsert(content=request.content, id=memory_id)
    return MemoryItem(id=memory_id, content=request.content)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: str,
    service: QdrantUserVectorService = Depends(get_memory_service),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a specific memory entry.
    Records a snapshot for audit trail before deleting.
    """
    # Fetch current content for snapshot
    old_content = None
    try:
        results = await service.search(memory_id, limit=1)
        if results:
            old_content = results[0].get("content")
    except Exception:
        pass

    repo = MemorySnapshotRepository(db)
    await repo.create(
        user_id=current_user.id,
        memory_point_id=memory_id,
        action="delete",
        old_content=old_content,
    )
    await db.commit()

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


# --- Snapshot & Rollback Endpoints ---


@router.get("/{memory_id}/snapshots", response_model=MemorySnapshotListResponse)
async def list_memory_snapshots(
    memory_id: str,
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List audit trail snapshots for a specific memory entry.
    """
    repo = MemorySnapshotRepository(db)
    snapshots = await repo.list_by_memory(
        user_id=current_user.id,
        memory_point_id=memory_id,
        limit=limit,
    )
    return MemorySnapshotListResponse(
        items=[MemorySnapshotItem.model_validate(s) for s in snapshots],
    )


@router.post("/{memory_id}/rollback", response_model=MemoryRollbackResponse)
async def rollback_memory(
    memory_id: str,
    request: MemoryRollbackRequest,
    service: QdrantUserVectorService = Depends(get_memory_service),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Rollback a memory to a previous snapshot state.
    Restores old_content from the snapshot and re-embeds.
    """
    repo = MemorySnapshotRepository(db)
    snapshot = await repo.get_by_id(
        snapshot_id=request.snapshot_id,
        user_id=current_user.id,
    )

    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot {request.snapshot_id} not found.",
        )

    if snapshot.memory_point_id != memory_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Snapshot does not belong to this memory.",
        )

    restore_content = snapshot.old_content
    if not restore_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Snapshot has no old_content to restore.",
        )

    # Record the rollback as a new snapshot
    await repo.create(
        user_id=current_user.id,
        memory_point_id=memory_id,
        action="rollback",
        new_content=restore_content,
    )
    await db.commit()

    # Re-embed and upsert
    await service.upsert(content=restore_content, id=memory_id)

    return MemoryRollbackResponse(
        success=True,
        memory_point_id=memory_id,
        restored_content=restore_content,
    )
