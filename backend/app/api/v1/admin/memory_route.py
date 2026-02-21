import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import settings
from app.deps.auth import get_current_active_superuser
from app.qdrant_client import get_qdrant_client
from app.schemas.memory import MemoryItem, MemoryListResponse, MemoryUpdateRequest
from app.storage.qdrant_kb_collections import get_kb_system_collection_name
from app.storage.qdrant_kb_store import (
    delete_points,
    scroll_points,
    upsert_point,
)
from app.services.providers.embedding import EmbeddingService

router = APIRouter(prefix="/memory", tags=["Admin - System Memory"])

# 系统集合名称
SYSTEM_COLLECTION = get_kb_system_collection_name()

async def get_embedding_service() -> EmbeddingService:
    return EmbeddingService()

@router.get("", response_model=MemoryListResponse)
async def list_system_memories(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None, description="Pagination cursor"),
    current_user: Any = Depends(get_current_active_superuser),
):
    """
    列出系统公共知识库中的所有条目（仅限管理员）。
    """
    client = get_qdrant_client()
    # 系统维度没有 user_id 过滤
    points, next_cursor = await scroll_points(
        client,
        collection_name=SYSTEM_COLLECTION,
        limit=limit,
        with_payload=True,
        offset=cursor,
    )
    
    results = [
        MemoryItem(
            id=item.get("id"),
            content=(item.get("payload") or {}).get("content", ""),
            payload=item.get("payload") or {},
        )
        for item in points
    ]
    
    return MemoryListResponse(items=results, next_cursor=next_cursor)

@router.post("", response_model=MemoryItem)
async def add_system_memory(
    request: MemoryUpdateRequest,
    current_user: Any = Depends(get_current_active_superuser),
    embed_service: EmbeddingService = Depends(get_embedding_service),
):
    """
    向系统知识库添加新条目。
    """
    client = get_qdrant_client()
    point_id = str(uuid.uuid4())
    vector = await embed_service.embed_text(request.content)
    
    payload = {
        "content": request.content,
        "is_system": True,
        "created_by": str(current_user.id),
        "type": "system_knowledge"
    }
    
    await upsert_point(
        client,
        collection_name=SYSTEM_COLLECTION,
        point_id=point_id,
        vector=vector,
        payload=payload,
        wait=True
    )
    
    return MemoryItem(id=point_id, content=request.content, payload=payload)

@router.patch("/{memory_id}", response_model=MemoryItem)
async def update_system_memory(
    memory_id: str,
    request: MemoryUpdateRequest,
    current_user: Any = Depends(get_current_active_superuser),
    embed_service: EmbeddingService = Depends(get_embedding_service),
):
    """
    更新系统知识库中的条目。
    """
    client = get_qdrant_client()
    vector = await embed_service.embed_text(request.content)
    
    payload = {
        "content": request.content,
        "is_system": True,
        "updated_by": str(current_user.id),
        "type": "system_knowledge"
    }
    
    await upsert_point(
        client,
        collection_name=SYSTEM_COLLECTION,
        point_id=memory_id,
        vector=vector,
        payload=payload,
        wait=True
    )
    
    return MemoryItem(id=memory_id, content=request.content, payload=payload)

@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system_memory(
    memory_id: str,
    current_user: Any = Depends(get_current_active_superuser),
):
    """
    从系统知识库中删除条目。
    """
    client = get_qdrant_client()
    await delete_points(
        client,
        collection_name=SYSTEM_COLLECTION,
        points_ids=[memory_id],
        wait=True
    )
    return None
