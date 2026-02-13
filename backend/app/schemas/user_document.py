from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, IDSchema, TimestampSchema


class KnowledgeFolderCreateRequest(BaseSchema):
    name: str = Field(..., min_length=1, max_length=255, description="文件夹名称")
    parent_id: UUID | None = Field(None, description="父文件夹 ID，根目录为 null")


class KnowledgeFolderUpdateRequest(BaseSchema):
    name: str = Field(..., min_length=1, max_length=255, description="文件夹名称")


class KnowledgeFolderRead(IDSchema, TimestampSchema):
    name: str
    parent_id: UUID | None
    file_count: int = Field(0, description="该目录下的直接文件数量")


class KnowledgeFileUpdateRequest(BaseSchema):
    name: str | None = Field(None, min_length=1, max_length=255, description="新文件名")
    folder_id: UUID | None = Field(None, description="目标文件夹 ID，null 表示根目录")


class KnowledgeFileCopyRequest(BaseSchema):
    name: str | None = Field(None, min_length=1, max_length=255, description="复制后的文件名")
    folder_id: UUID | None = Field(None, description="复制目标文件夹 ID，null 表示根目录")


class KnowledgeFileBatchDeleteRequest(BaseSchema):
    file_ids: list[UUID] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="待删除文件 ID 列表",
    )


class KnowledgeFileBatchDeleteResponse(BaseSchema):
    deleted_count: int
    failed: list["KnowledgeFileBatchFailure"] = Field(default_factory=list)


class KnowledgeFileBatchMoveRequest(BaseSchema):
    file_ids: list[UUID] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="待移动文件 ID 列表",
    )
    folder_id: UUID | None = Field(
        ...,
        description="移动目标文件夹 ID，null 表示根目录",
    )


class KnowledgeFileBatchMoveResponse(BaseSchema):
    files: list["KnowledgeFileRead"]
    failed: list["KnowledgeFileBatchFailure"] = Field(default_factory=list)


class KnowledgeFileBatchCopyRequest(BaseSchema):
    file_ids: list[UUID] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="待复制文件 ID 列表",
    )
    folder_id: UUID | None = Field(
        None,
        description="复制目标文件夹 ID，null 表示根目录；不传则沿用原目录",
    )


class KnowledgeFileBatchCopyResponse(BaseSchema):
    files: list["KnowledgeFileRead"]
    failed: list["KnowledgeFileBatchFailure"] = Field(default_factory=list)


class KnowledgeFileBatchRetryRequest(BaseSchema):
    file_ids: list[UUID] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="待重试索引的文件 ID 列表",
    )


class KnowledgeFileBatchRetryResponse(BaseSchema):
    files: list["KnowledgeFileRead"]
    failed: list["KnowledgeFileBatchFailure"] = Field(default_factory=list)


class KnowledgeFileRead(IDSchema, TimestampSchema):
    name: str
    type: str
    size: int
    status: str
    chunks: int | None
    error_message: str | None = None
    folder_id: UUID | None


class KnowledgeFileDownloadResponse(BaseSchema):
    download_url: str


class KnowledgeFileShareRequest(BaseSchema):
    expires_seconds: int | None = Field(
        None,
        gt=0,
        description="分享链接有效期（秒），不传则使用系统默认值",
    )


class KnowledgeFileShareResponse(BaseSchema):
    share_url: str


class KnowledgeFileBatchShareRequest(BaseSchema):
    file_ids: list[UUID] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="待生成分享链接的文件 ID 列表",
    )
    expires_seconds: int | None = Field(
        None,
        gt=0,
        description="分享链接有效期（秒），不传则使用系统默认值",
    )


class KnowledgeFileBatchShareItem(BaseSchema):
    file_id: UUID
    share_url: str


class KnowledgeFileBatchFailureReason(str, Enum):
    NOT_FOUND = "not_found"
    ALREADY_PROCESSING = "already_processing"
    MEDIA_ASSET_NOT_FOUND = "media_asset_not_found"


class KnowledgeFileBatchFailure(BaseSchema):
    file_id: UUID
    reason: KnowledgeFileBatchFailureReason
    message: str | None = None


class KnowledgeFileBatchShareResponse(BaseSchema):
    items: list[KnowledgeFileBatchShareItem]
    failed: list[KnowledgeFileBatchFailure] = Field(default_factory=list)


class KnowledgeBreadcrumbItem(BaseSchema):
    id: UUID | None
    name: str


class KnowledgeTreeResponse(BaseSchema):
    folders: list[KnowledgeFolderRead]
    files: list[KnowledgeFileRead]
    breadcrumb: list[KnowledgeBreadcrumbItem]


class KnowledgeStatsResponse(BaseSchema):
    used_bytes: int
    total_bytes: int
    total_vectors: int
    total_files: int
    total_folders: int


class KnowledgeChunkRead(BaseSchema):
    id: str
    file_id: UUID
    index: int
    content: str
    token_count: int


class KnowledgeChunkListResponse(BaseSchema):
    items: list[KnowledgeChunkRead]
    total: int
    offset: int
    limit: int


class KnowledgeSearchRequest(BaseSchema):
    query: str = Field(..., min_length=1, max_length=2000)
    limit: int = Field(5, ge=1, le=20)
    doc_ids: list[UUID] | None = None


class KnowledgeSearchResult(BaseSchema):
    score: float
    text: str | None
    filename: str | None
    page: int | None
    doc_id: str | None


__all__ = [
    "KnowledgeBreadcrumbItem",
    "KnowledgeFileBatchCopyRequest",
    "KnowledgeFileBatchCopyResponse",
    "KnowledgeFileBatchDeleteRequest",
    "KnowledgeFileBatchDeleteResponse",
    "KnowledgeFileBatchMoveRequest",
    "KnowledgeFileBatchMoveResponse",
    "KnowledgeFileBatchRetryRequest",
    "KnowledgeFileBatchRetryResponse",
    "KnowledgeFileBatchFailure",
    "KnowledgeFileBatchFailureReason",
    "KnowledgeFileBatchShareItem",
    "KnowledgeFileBatchShareRequest",
    "KnowledgeFileBatchShareResponse",
    "KnowledgeChunkListResponse",
    "KnowledgeChunkRead",
    "KnowledgeFileCopyRequest",
    "KnowledgeFileDownloadResponse",
    "KnowledgeFileRead",
    "KnowledgeFileShareRequest",
    "KnowledgeFileShareResponse",
    "KnowledgeFileUpdateRequest",
    "KnowledgeFolderCreateRequest",
    "KnowledgeFolderRead",
    "KnowledgeFolderUpdateRequest",
    "KnowledgeSearchRequest",
    "KnowledgeSearchResult",
    "KnowledgeStatsResponse",
    "KnowledgeTreeResponse",
]
