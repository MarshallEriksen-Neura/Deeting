import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.db import get_session
from app.api.deps.user import get_current_user
from app.models.user import User
from app.services.knowledge.user_document_service import UserDocumentService

router = APIRouter()

@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    上传用户文档 (PDF/Docx/Txt) 并触发 RAG 索引。
    """
    # Basic Validation
    if not file.filename:
        raise HTTPException(400, "Filename is required")
    
    ext = file.filename.lower().split(".")[-1]
    if ext not in ["pdf", "docx", "doc", "txt", "md"]:
        raise HTTPException(400, "Unsupported file extension")

    service = UserDocumentService(session)
    try:
        doc = await service.upload_file(user_id=current_user.id, file=file)
        return {"id": doc.id, "filename": doc.filename, "status": doc.status}
    except Exception as e:
        raise HTTPException(500, f"Upload failed: {str(e)}")

@router.get("/", status_code=status.HTTP_200_OK)
async def list_documents(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    获取当前用户的所有文档状态。
    """
    service = UserDocumentService(session)
    docs = await service.list_documents(user_id=current_user.id)
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "status": d.status,
            "chunk_count": d.chunk_count,
            "created_at": d.created_at,
            "error_message": d.error_message
        }
        for d in docs
    ]

@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    删除文档 (包含数据库记录和向量库索引)。
    """
    service = UserDocumentService(session)
    success = await service.delete_document(user_id=current_user.id, doc_id=doc_id)
    if not success:
        raise HTTPException(404, "Document not found or permission denied")
    return

@router.post("/search", status_code=status.HTTP_200_OK)
async def search_documents(
    query: str,
    limit: int = 5,
    doc_ids: list[uuid.UUID] | None = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    测试检索接口 (调试用)。
    """
    service = UserDocumentService(session)
    results = await service.search(
        user_id=current_user.id,
        query=query,
        limit=limit,
        doc_ids=doc_ids
    )
    return results
