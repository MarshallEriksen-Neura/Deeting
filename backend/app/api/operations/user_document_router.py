from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, Form, Query, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user
from app.models.user import User
from app.schemas.auth import MessageResponse
from app.schemas.user_document import (
    KnowledgeChunkListResponse,
    KnowledgeFileBatchCopyRequest,
    KnowledgeFileBatchCopyResponse,
    KnowledgeFileBatchDeleteRequest,
    KnowledgeFileBatchDeleteResponse,
    KnowledgeFileBatchMoveRequest,
    KnowledgeFileBatchMoveResponse,
    KnowledgeFileBatchRetryRequest,
    KnowledgeFileBatchRetryResponse,
    KnowledgeFileBatchShareRequest,
    KnowledgeFileBatchShareResponse,
    KnowledgeFileCopyRequest,
    KnowledgeFileDownloadResponse,
    KnowledgeFileRead,
    KnowledgeFileShareRequest,
    KnowledgeFileShareResponse,
    KnowledgeFileUpdateRequest,
    KnowledgeFolderCreateRequest,
    KnowledgeFolderRead,
    KnowledgeFolderUpdateRequest,
    KnowledgeSearchRequest,
    KnowledgeSearchResult,
    KnowledgeStatsResponse,
    KnowledgeTreeResponse,
)
from app.services.knowledge.user_document_service import UserDocumentService

router = APIRouter()


def get_service(session: AsyncSession = Depends(get_db)) -> UserDocumentService:
    return UserDocumentService(session)


@router.get("/stats", response_model=KnowledgeStatsResponse)
async def get_document_stats(
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeStatsResponse:
    return await service.get_stats(user_id=current_user.id)


@router.get("/tree", response_model=KnowledgeTreeResponse)
async def list_tree(
    parent_id: UUID | None = Query(None, description="父目录 ID，null 表示根目录"),
    q: str | None = Query(None, description="按名称模糊搜索（当前目录范围）"),
    sort_field: str = Query("created_at", description="排序字段：name/size/status/chunks/created_at"),
    sort_direction: str = Query("desc", description="排序方向：asc/desc"),
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeTreeResponse:
    return await service.list_tree(
        user_id=current_user.id,
        parent_id=parent_id,
        query=q,
        sort_field=sort_field,
        sort_direction=sort_direction,
    )


@router.post("/folders", response_model=KnowledgeFolderRead, status_code=status.HTTP_201_CREATED)
async def create_folder(
    payload: KnowledgeFolderCreateRequest,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFolderRead:
    return await service.create_folder(
        user_id=current_user.id,
        name=payload.name,
        parent_id=payload.parent_id,
    )


@router.patch("/folders/{folder_id}", response_model=KnowledgeFolderRead)
async def rename_folder(
    folder_id: UUID,
    payload: KnowledgeFolderUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFolderRead:
    return await service.rename_folder(
        user_id=current_user.id,
        folder_id=folder_id,
        name=payload.name,
    )


@router.delete("/folders/{folder_id}", response_model=MessageResponse)
async def delete_folder(
    folder_id: UUID,
    recursive: bool = Query(False, description="是否递归删除子目录与文件"),
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> MessageResponse:
    await service.delete_folder(
        user_id=current_user.id,
        folder_id=folder_id,
        recursive=recursive,
    )
    return MessageResponse(message="Folder deleted")


@router.post("/files", response_model=KnowledgeFileRead, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    folder_id: UUID | None = Form(None),
    meta_info: str | None = Form(None),
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileRead:
    return await service.upload_file(
        user_id=current_user.id,
        file=file,
        folder_id=folder_id,
        meta_info=await service.parse_meta_info(meta_info),
    )


@router.post("/files/batch/delete", response_model=KnowledgeFileBatchDeleteResponse)
async def batch_delete_files(
    payload: KnowledgeFileBatchDeleteRequest,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileBatchDeleteResponse:
    return await service.batch_delete_files(
        user_id=current_user.id,
        file_ids=payload.file_ids,
    )


@router.post("/files/batch/move", response_model=KnowledgeFileBatchMoveResponse)
async def batch_move_files(
    payload: KnowledgeFileBatchMoveRequest,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileBatchMoveResponse:
    return await service.batch_move_files(
        user_id=current_user.id,
        file_ids=payload.file_ids,
        folder_id=payload.folder_id,
    )


@router.post("/files/batch/retry", response_model=KnowledgeFileBatchRetryResponse)
async def batch_retry_files(
    payload: KnowledgeFileBatchRetryRequest,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileBatchRetryResponse:
    return await service.batch_retry_files(
        user_id=current_user.id,
        file_ids=payload.file_ids,
    )


@router.post("/files/batch/share", response_model=KnowledgeFileBatchShareResponse)
async def batch_share_files(
    payload: KnowledgeFileBatchShareRequest,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileBatchShareResponse:
    return await service.batch_share_files(
        user_id=current_user.id,
        file_ids=payload.file_ids,
        base_url=str(request.base_url).rstrip("/"),
        expires_seconds=payload.expires_seconds,
    )


@router.post(
    "/files/batch/copy",
    response_model=KnowledgeFileBatchCopyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def batch_copy_files(
    payload: KnowledgeFileBatchCopyRequest,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileBatchCopyResponse:
    payload_dict = payload.model_dump(exclude_unset=True)
    return await service.batch_copy_files(
        user_id=current_user.id,
        file_ids=payload.file_ids,
        folder_id=payload_dict.get("folder_id"),
        folder_id_provided="folder_id" in payload_dict,
    )


@router.get("/files/{file_id}", response_model=KnowledgeFileRead)
async def get_file(
    file_id: UUID,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileRead:
    return await service.get_file(user_id=current_user.id, file_id=file_id)


@router.patch("/files/{file_id}", response_model=KnowledgeFileRead)
async def update_file(
    file_id: UUID,
    payload: KnowledgeFileUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileRead:
    payload_dict = payload.model_dump(exclude_unset=True)
    return await service.update_file(
        user_id=current_user.id,
        file_id=file_id,
        name=payload_dict.get("name"),
        folder_id=payload_dict.get("folder_id"),
        folder_id_provided="folder_id" in payload_dict,
    )


@router.post("/files/{file_id}/copy", response_model=KnowledgeFileRead, status_code=status.HTTP_201_CREATED)
async def copy_file(
    file_id: UUID,
    payload: KnowledgeFileCopyRequest = Body(default_factory=KnowledgeFileCopyRequest),
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileRead:
    payload_dict = payload.model_dump(exclude_unset=True)
    return await service.copy_file(
        user_id=current_user.id,
        file_id=file_id,
        name=payload_dict.get("name"),
        folder_id=payload_dict.get("folder_id"),
        folder_id_provided="folder_id" in payload_dict,
    )


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: UUID,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> Response:
    await service.delete_file(user_id=current_user.id, file_id=file_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/files/{file_id}/retry", response_model=KnowledgeFileRead)
async def retry_file(
    file_id: UUID,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileRead:
    return await service.retry_file(user_id=current_user.id, file_id=file_id)


@router.get("/files/{file_id}/chunks", response_model=KnowledgeChunkListResponse)
async def list_file_chunks(
    file_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeChunkListResponse:
    return await service.list_chunks(
        user_id=current_user.id,
        file_id=file_id,
        offset=offset,
        limit=limit,
    )


@router.get("/files/{file_id}/download-url", response_model=KnowledgeFileDownloadResponse)
async def get_file_download_url(
    file_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileDownloadResponse:
    url = await service.get_download_url(
        user_id=current_user.id,
        file_id=file_id,
        base_url=str(request.base_url).rstrip("/"),
    )
    return KnowledgeFileDownloadResponse(download_url=url)


@router.post("/files/{file_id}/share", response_model=KnowledgeFileShareResponse)
async def share_file(
    file_id: UUID,
    request: Request,
    payload: KnowledgeFileShareRequest = Body(default_factory=KnowledgeFileShareRequest),
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> KnowledgeFileShareResponse:
    share_url = await service.share_file(
        user_id=current_user.id,
        file_id=file_id,
        base_url=str(request.base_url).rstrip("/"),
        expires_seconds=payload.expires_seconds,
    )
    return KnowledgeFileShareResponse(share_url=share_url)


@router.post("/search", response_model=list[KnowledgeSearchResult])
async def search_documents(
    payload: KnowledgeSearchRequest,
    current_user: User = Depends(get_current_active_user),
    service: UserDocumentService = Depends(get_service),
) -> list[KnowledgeSearchResult]:
    return await service.search(
        user_id=current_user.id,
        query=payload.query,
        limit=payload.limit,
        doc_ids=payload.doc_ids,
    )


__all__ = ["router"]
