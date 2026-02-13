from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.logging import logger
from app.models.user_document import UserDocument
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.knowledge_folder_repository import KnowledgeFolderRepository
from app.repositories.media_asset_repository import MediaAssetRepository
from app.repositories.user_document_repository import UserDocumentRepository
from app.schemas.user_document import (
    KnowledgeBreadcrumbItem,
    KnowledgeChunkListResponse,
    KnowledgeChunkRead,
    KnowledgeFileBatchCopyResponse,
    KnowledgeFileBatchDeleteResponse,
    KnowledgeFileBatchFailure,
    KnowledgeFileBatchFailureReason,
    KnowledgeFileBatchMoveResponse,
    KnowledgeFileBatchRetryResponse,
    KnowledgeFileBatchShareItem,
    KnowledgeFileBatchShareResponse,
    KnowledgeFileRead,
    KnowledgeFolderRead,
    KnowledgeSearchResult,
    KnowledgeStatsResponse,
    KnowledgeTreeResponse,
)
from app.services.oss.asset_storage_service import build_signed_asset_url, store_asset_bytes
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_collections import get_kb_user_collection_name
from app.storage.qdrant_kb_store import delete_points, scroll_points, search_points

_ALLOWED_EXTENSIONS = {
    "pdf",
    "txt",
    "docx",
    "doc",
    "md",
    "csv",
    "html",
    "json",
}
_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
_DEFAULT_TOTAL_STORAGE_BYTES = 500 * 1024 * 1024

_DB_TO_API_STATUS = {
    "pending": "processing",
    "processing": "processing",
    "indexed": "active",
    "failed": "failed",
}


class UserDocumentService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.folder_repo = KnowledgeFolderRepository(session)
        self.document_repo = UserDocumentRepository(session)
        self.media_repo = MediaAssetRepository(session)
        self.embedding_service = EmbeddingService()

    async def get_stats(self, *, user_id: UUID) -> KnowledgeStatsResponse:
        used_bytes = await self.document_repo.sum_size_bytes_by_user(user_id=user_id)
        total_vectors = await self.document_repo.sum_chunks_by_user(user_id=user_id)
        total_files = await self.document_repo.count_by_user(user_id=user_id)
        total_folders = await self.folder_repo.count_by_user(user_id=user_id)

        return KnowledgeStatsResponse(
            used_bytes=used_bytes,
            total_bytes=max(_DEFAULT_TOTAL_STORAGE_BYTES, used_bytes),
            total_vectors=total_vectors,
            total_files=total_files,
            total_folders=total_folders,
        )

    async def list_tree(
        self,
        *,
        user_id: UUID,
        parent_id: UUID | None,
        query: str | None,
        sort_field: str,
        sort_direction: str,
    ) -> KnowledgeTreeResponse:
        if parent_id is not None:
            parent = await self.folder_repo.get_owned(parent_id, user_id)
            if parent is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Folder not found",
                )

        folders = await self.folder_repo.list_by_parent(user_id=user_id, parent_id=parent_id)
        docs = await self.document_repo.list_by_folder(user_id=user_id, folder_id=parent_id)

        q = (query or "").strip().lower()
        if q:
            folders = [folder for folder in folders if q in folder.name.lower()]
            docs = [doc for doc in docs if q in doc.filename.lower()]

        folder_ids = [folder.id for folder in folders]
        file_count_map = await self.document_repo.count_by_folder_ids(
            user_id=user_id,
            folder_ids=folder_ids,
        )

        folder_items = [
            KnowledgeFolderRead(
                id=folder.id,
                name=folder.name,
                parent_id=folder.parent_id,
                file_count=file_count_map.get(folder.id, 0),
                created_at=folder.created_at,
                updated_at=folder.updated_at,
            )
            for folder in folders
        ]
        file_items = [self._to_file_read(doc) for doc in docs]

        reverse = str(sort_direction or "desc").lower() == "desc"
        folder_items.sort(key=lambda item: self._folder_sort_key(item, sort_field), reverse=reverse)
        file_items.sort(key=lambda item: self._file_sort_key(item, sort_field), reverse=reverse)

        breadcrumb = await self._build_breadcrumb(user_id=user_id, parent_id=parent_id)
        return KnowledgeTreeResponse(
            folders=folder_items,
            files=file_items,
            breadcrumb=breadcrumb,
        )

    async def create_folder(
        self,
        *,
        user_id: UUID,
        name: str,
        parent_id: UUID | None,
    ) -> KnowledgeFolderRead:
        normalized_name = name.strip()
        if not normalized_name:
            raise HTTPException(status_code=400, detail="Folder name is required")

        if parent_id is not None:
            parent = await self.folder_repo.get_owned(parent_id, user_id)
            if parent is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Parent folder not found",
                )

        duplicated = await self.folder_repo.exists_name(
            user_id=user_id,
            parent_id=parent_id,
            name=normalized_name,
        )
        if duplicated:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Folder with the same name already exists",
            )

        folder = await self.folder_repo.create(
            user_id=user_id,
            name=normalized_name,
            parent_id=parent_id,
        )
        await self.session.commit()

        return KnowledgeFolderRead(
            id=folder.id,
            name=folder.name,
            parent_id=folder.parent_id,
            file_count=0,
            created_at=folder.created_at,
            updated_at=folder.updated_at,
        )

    async def rename_folder(
        self,
        *,
        user_id: UUID,
        folder_id: UUID,
        name: str,
    ) -> KnowledgeFolderRead:
        folder = await self.folder_repo.get_owned(folder_id, user_id)
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")

        normalized_name = name.strip()
        if not normalized_name:
            raise HTTPException(status_code=400, detail="Folder name is required")

        duplicated = await self.folder_repo.exists_name(
            user_id=user_id,
            parent_id=folder.parent_id,
            name=normalized_name,
            exclude_id=folder.id,
        )
        if duplicated:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Folder with the same name already exists",
            )

        folder.name = normalized_name
        self.session.add(folder)
        await self.session.commit()
        await self.session.refresh(folder)

        file_count = await self.document_repo.count_by_folder(user_id=user_id, folder_id=folder.id)
        return KnowledgeFolderRead(
            id=folder.id,
            name=folder.name,
            parent_id=folder.parent_id,
            file_count=file_count,
            created_at=folder.created_at,
            updated_at=folder.updated_at,
        )

    async def delete_folder(
        self,
        *,
        user_id: UUID,
        folder_id: UUID,
        recursive: bool,
    ) -> None:
        folder = await self.folder_repo.get_owned(folder_id, user_id)
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")

        descendant_ids = await self._collect_descendant_folder_ids(
            user_id=user_id,
            root_id=folder_id,
        )
        all_folder_ids = [folder_id, *descendant_ids]

        if not recursive:
            has_children = await self.folder_repo.has_children(folder_id=folder_id, user_id=user_id)
            has_files = await self.document_repo.count_by_folder(user_id=user_id, folder_id=folder_id)
            if has_children or has_files:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Folder is not empty; use recursive=true to delete",
                )

        docs = await self.document_repo.list_by_folder_ids(
            user_id=user_id,
            folder_ids=all_folder_ids,
        )
        if docs and not recursive:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Folder is not empty; use recursive=true to delete",
            )

        for doc in docs:
            await self._delete_document_vectors(user_id=user_id, doc_id=doc.id)
            await self.document_repo.delete(doc)

        await self.folder_repo.delete(folder)
        await self.session.commit()

    async def upload_file(
        self,
        *,
        user_id: UUID,
        file: UploadFile,
        folder_id: UUID | None,
        meta_info: dict[str, Any] | None,
    ) -> KnowledgeFileRead:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")

        ext = self._extract_extension(file.filename)
        if ext not in _ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file extension: .{ext}",
            )

        if folder_id is not None:
            folder = await self.folder_repo.get_owned(folder_id, user_id)
            if folder is None:
                raise HTTPException(status_code=404, detail="Folder not found")

        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="File is empty")
        if len(content) > _MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File size exceeds {_MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB limit",
            )

        content_hash = hashlib.sha256(content).hexdigest()
        content_size = len(content)

        media_asset = await self.media_repo.get_by_hash(content_hash, content_size)
        if media_asset is None:
            stored = await store_asset_bytes(
                content,
                content_type=file.content_type or "application/octet-stream",
                kind="rag_document",
            )
            media_asset = await self.media_repo.create_asset(
                {
                    "content_hash": content_hash,
                    "size_bytes": stored.size_bytes,
                    "content_type": stored.content_type,
                    "object_key": stored.object_key,
                    "etag": None,
                    "uploader_user_id": user_id,
                },
                commit=False,
            )

        doc = await self.document_repo.create(
            user_id=user_id,
            media_asset_id=media_asset.id,
            filename=file.filename,
            folder_id=folder_id,
            status="pending",
            meta_info=meta_info or {},
        )
        await self.session.commit()

        self._enqueue_index_task(doc_id=doc.id)

        doc = await self.document_repo.get_owned(doc_id=doc.id, user_id=user_id)
        if doc is None:
            raise HTTPException(status_code=500, detail="Failed to load uploaded document")
        return self._to_file_read(doc)

    async def get_file(self, *, user_id: UUID, file_id: UUID) -> KnowledgeFileRead:
        doc = await self.document_repo.get_owned(doc_id=file_id, user_id=user_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")
        return self._to_file_read(doc)

    async def update_file(
        self,
        *,
        user_id: UUID,
        file_id: UUID,
        name: str | None,
        folder_id: UUID | None,
        folder_id_provided: bool,
    ) -> KnowledgeFileRead:
        doc = await self.document_repo.get_owned(doc_id=file_id, user_id=user_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")

        updated = False
        if name is not None:
            normalized_name = name.strip()
            if not normalized_name:
                raise HTTPException(status_code=400, detail="File name is required")
            doc.filename = normalized_name
            updated = True

        if folder_id_provided:
            if folder_id is not None:
                folder = await self.folder_repo.get_owned(folder_id, user_id)
                if folder is None:
                    raise HTTPException(status_code=404, detail="Folder not found")
            doc.folder_id = folder_id
            updated = True

        if updated:
            self.session.add(doc)
            await self.session.commit()
            await self.session.refresh(doc)

        return self._to_file_read(doc)

    async def delete_file(self, *, user_id: UUID, file_id: UUID) -> None:
        doc = await self.document_repo.get_owned(doc_id=file_id, user_id=user_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")

        await self._delete_document_vectors(user_id=user_id, doc_id=doc.id)
        await self.document_repo.delete(doc)
        await self.session.commit()

    async def batch_delete_files(
        self,
        *,
        user_id: UUID,
        file_ids: list[UUID],
    ) -> KnowledgeFileBatchDeleteResponse:
        docs, failed = await self._resolve_owned_docs(
            user_id=user_id,
            file_ids=file_ids,
        )

        for doc in docs:
            await self._delete_document_vectors(user_id=user_id, doc_id=doc.id)
            await self.document_repo.delete(doc)
        if docs:
            await self.session.commit()

        return KnowledgeFileBatchDeleteResponse(
            deleted_count=len(docs),
            failed=failed,
        )

    async def batch_move_files(
        self,
        *,
        user_id: UUID,
        file_ids: list[UUID],
        folder_id: UUID | None,
    ) -> KnowledgeFileBatchMoveResponse:
        if folder_id is not None:
            folder = await self.folder_repo.get_owned(folder_id, user_id)
            if folder is None:
                raise HTTPException(status_code=404, detail="Folder not found")

        docs, failed = await self._resolve_owned_docs(
            user_id=user_id,
            file_ids=file_ids,
        )
        for doc in docs:
            doc.folder_id = folder_id
            self.session.add(doc)
        if docs:
            await self.session.commit()

        return KnowledgeFileBatchMoveResponse(
            files=[self._to_file_read(doc) for doc in docs],
            failed=failed,
        )

    async def batch_copy_files(
        self,
        *,
        user_id: UUID,
        file_ids: list[UUID],
        folder_id: UUID | None,
        folder_id_provided: bool,
    ) -> KnowledgeFileBatchCopyResponse:
        if folder_id_provided and folder_id is not None:
            folder = await self.folder_repo.get_owned(folder_id, user_id)
            if folder is None:
                raise HTTPException(status_code=404, detail="Folder not found")

        source_docs, failed = await self._resolve_owned_docs(
            user_id=user_id,
            file_ids=file_ids,
        )

        copied_ids: list[UUID] = []
        for source_doc in source_docs:
            target_folder_id = folder_id if folder_id_provided else source_doc.folder_id
            source_meta_info = (
                source_doc.meta_info if isinstance(source_doc.meta_info, dict) else {}
            )
            target_meta_info = dict(source_meta_info)
            target_meta_info["copied_from_doc_id"] = str(source_doc.id)

            copied = await self.document_repo.create(
                user_id=user_id,
                media_asset_id=source_doc.media_asset_id,
                filename=self._build_copy_filename(source_doc.filename),
                folder_id=target_folder_id,
                status="pending",
                meta_info=target_meta_info,
            )
            copied_ids.append(copied.id)

        if copied_ids:
            await self.session.commit()

        for copied_id in copied_ids:
            self._enqueue_index_task(doc_id=copied_id)

        copied_docs = await self.document_repo.list_owned_by_ids(
            user_id=user_id,
            doc_ids=copied_ids,
        )
        copied_doc_map = {doc.id: doc for doc in copied_docs}
        ordered_docs = [copied_doc_map[doc_id] for doc_id in copied_ids if doc_id in copied_doc_map]

        return KnowledgeFileBatchCopyResponse(
            files=[self._to_file_read(doc) for doc in ordered_docs],
            failed=failed,
        )

    async def batch_retry_files(
        self,
        *,
        user_id: UUID,
        file_ids: list[UUID],
    ) -> KnowledgeFileBatchRetryResponse:
        docs, failed = await self._resolve_owned_docs(
            user_id=user_id,
            file_ids=file_ids,
        )
        retryable_docs: list[UserDocument] = []
        for doc in docs:
            if doc.status == "processing":
                failed.append(
                    KnowledgeFileBatchFailure(
                        file_id=doc.id,
                        reason=KnowledgeFileBatchFailureReason.ALREADY_PROCESSING,
                        message="Document is already processing",
                    )
                )
                continue
            retryable_docs.append(doc)

        for doc in retryable_docs:
            await self.document_repo.update(
                doc,
                status="pending",
                error_message=None,
                chunk_count=0,
                embedding_model=None,
            )
        if retryable_docs:
            await self.session.commit()

        for doc in retryable_docs:
            self._enqueue_index_task(doc_id=doc.id)

        return KnowledgeFileBatchRetryResponse(
            files=[self._to_file_read(doc) for doc in retryable_docs],
            failed=failed,
        )

    async def batch_share_files(
        self,
        *,
        user_id: UUID,
        file_ids: list[UUID],
        base_url: str,
        expires_seconds: int | None,
    ) -> KnowledgeFileBatchShareResponse:
        docs, failed = await self._resolve_owned_docs(
            user_id=user_id,
            file_ids=file_ids,
        )
        items: list[KnowledgeFileBatchShareItem] = []

        for doc in docs:
            media_asset = doc.media_asset
            if media_asset is None:
                failed.append(
                    KnowledgeFileBatchFailure(
                        file_id=doc.id,
                        reason=KnowledgeFileBatchFailureReason.MEDIA_ASSET_NOT_FOUND,
                        message="Media asset not found",
                    )
                )
                continue
            items.append(
                KnowledgeFileBatchShareItem(
                    file_id=doc.id,
                    share_url=build_signed_asset_url(
                        media_asset.object_key,
                        base_url=base_url,
                        ttl_seconds=expires_seconds,
                    ),
                )
            )

        return KnowledgeFileBatchShareResponse(
            items=items,
            failed=failed,
        )

    async def retry_file(self, *, user_id: UUID, file_id: UUID) -> KnowledgeFileRead:
        doc = await self.document_repo.get_owned(doc_id=file_id, user_id=user_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")
        if doc.status == "processing":
            raise HTTPException(status_code=409, detail="Document is already processing")

        await self.document_repo.update(
            doc,
            status="pending",
            error_message=None,
            chunk_count=0,
            embedding_model=None,
        )
        await self.session.commit()

        self._enqueue_index_task(doc_id=doc.id)

        doc = await self.document_repo.get_owned(doc_id=file_id, user_id=user_id)
        if doc is None:
            raise HTTPException(status_code=500, detail="Document not found after retry")
        return self._to_file_read(doc)

    async def copy_file(
        self,
        *,
        user_id: UUID,
        file_id: UUID,
        name: str | None,
        folder_id: UUID | None,
        folder_id_provided: bool,
    ) -> KnowledgeFileRead:
        source_doc = await self.document_repo.get_owned(doc_id=file_id, user_id=user_id)
        if source_doc is None:
            raise HTTPException(status_code=404, detail="Document not found")

        target_folder_id = source_doc.folder_id
        if folder_id_provided:
            if folder_id is not None:
                folder = await self.folder_repo.get_owned(folder_id, user_id)
                if folder is None:
                    raise HTTPException(status_code=404, detail="Folder not found")
            target_folder_id = folder_id

        if name is not None:
            normalized_name = name.strip()
            if not normalized_name:
                raise HTTPException(status_code=400, detail="File name is required")
            target_name = normalized_name
        else:
            target_name = self._build_copy_filename(source_doc.filename)

        source_meta_info = source_doc.meta_info if isinstance(source_doc.meta_info, dict) else {}
        target_meta_info = dict(source_meta_info)
        target_meta_info["copied_from_doc_id"] = str(source_doc.id)

        copied = await self.document_repo.create(
            user_id=user_id,
            media_asset_id=source_doc.media_asset_id,
            filename=target_name,
            folder_id=target_folder_id,
            status="pending",
            meta_info=target_meta_info,
        )
        await self.session.commit()

        self._enqueue_index_task(doc_id=copied.id)

        copied = await self.document_repo.get_owned(doc_id=copied.id, user_id=user_id)
        if copied is None:
            raise HTTPException(status_code=500, detail="Document not found after copy")
        return self._to_file_read(copied)

    async def share_file(
        self,
        *,
        user_id: UUID,
        file_id: UUID,
        base_url: str,
        expires_seconds: int | None,
    ) -> str:
        return await self.get_download_url(
            user_id=user_id,
            file_id=file_id,
            base_url=base_url,
            ttl_seconds=expires_seconds,
        )

    async def get_download_url(
        self,
        *,
        user_id: UUID,
        file_id: UUID,
        base_url: str,
        ttl_seconds: int | None = None,
    ) -> str:
        doc = await self.document_repo.get_owned(doc_id=file_id, user_id=user_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")
        media_asset = doc.media_asset
        if media_asset is None:
            raise HTTPException(status_code=404, detail="Media asset not found")

        return build_signed_asset_url(
            media_asset.object_key,
            base_url=base_url,
            ttl_seconds=ttl_seconds,
        )

    async def list_chunks(
        self,
        *,
        user_id: UUID,
        file_id: UUID,
        offset: int,
        limit: int,
    ) -> KnowledgeChunkListResponse:
        doc = await self.document_repo.get_owned(doc_id=file_id, user_id=user_id)
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found")

        if doc.status != "indexed" or not qdrant_is_configured():
            return KnowledgeChunkListResponse(
                items=[],
                total=int(doc.chunk_count or 0),
                offset=offset,
                limit=limit,
            )

        collection_name = get_kb_user_collection_name(user_id)
        expected = offset + limit
        gathered: list[dict[str, Any]] = []
        cursor: Any | None = None

        while len(gathered) < expected:
            batch, cursor = await scroll_points(
                get_qdrant_client(),
                collection_name=collection_name,
                limit=min(100, max(20, expected - len(gathered))),
                query_filter={
                    "must": [
                        {"key": "user_id", "match": {"value": str(user_id)}},
                        {"key": "doc_id", "match": {"value": str(file_id)}},
                    ]
                },
                with_payload=True,
                offset=cursor,
            )
            if not batch:
                break
            gathered.extend(batch)
            if cursor is None:
                break

        gathered.sort(
            key=lambda point: int((point.get("payload") or {}).get("chunk_index", 0))
        )
        sliced = gathered[offset : offset + limit]

        items: list[KnowledgeChunkRead] = []
        for point in sliced:
            payload = point.get("payload") or {}
            text = str(payload.get("text") or "")
            items.append(
                KnowledgeChunkRead(
                    id=str(point.get("id") or ""),
                    file_id=file_id,
                    index=int(payload.get("chunk_index", 0) or 0),
                    content=text,
                    token_count=self._estimate_tokens(text),
                )
            )

        return KnowledgeChunkListResponse(
            items=items,
            total=int(doc.chunk_count or len(gathered)),
            offset=offset,
            limit=limit,
        )

    async def search(
        self,
        *,
        user_id: UUID,
        query: str,
        limit: int,
        doc_ids: list[UUID] | None,
    ) -> list[KnowledgeSearchResult]:
        if not qdrant_is_configured():
            return []

        vector = await self.embedding_service.embed_text(query)
        must_filters: list[dict[str, Any]] = [
            {"key": "user_id", "match": {"value": str(user_id)}}
        ]
        if doc_ids:
            must_filters.append(
                {
                    "key": "doc_id",
                    "match": {"any": [str(doc_id) for doc_id in doc_ids]},
                }
            )

        results = await search_points(
            get_qdrant_client(),
            collection_name=get_kb_user_collection_name(user_id),
            vector=vector,
            limit=limit,
            query_filter={"must": must_filters},
            score_threshold=0.7,
            with_payload=True,
        )

        return [
            KnowledgeSearchResult(
                score=float(item.get("score") or 0.0),
                text=(item.get("payload") or {}).get("text"),
                filename=(item.get("payload") or {}).get("filename"),
                page=(item.get("payload") or {}).get("page"),
                doc_id=(item.get("payload") or {}).get("doc_id"),
            )
            for item in results
        ]

    async def parse_meta_info(self, meta_info_raw: str | None) -> dict[str, Any] | None:
        if meta_info_raw is None:
            return None
        text = meta_info_raw.strip()
        if not text:
            return None
        try:
            value = json.loads(text)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="meta_info must be valid JSON") from exc
        if not isinstance(value, dict):
            raise HTTPException(status_code=400, detail="meta_info must be a JSON object")
        return value

    async def _resolve_owned_docs(
        self,
        *,
        user_id: UUID,
        file_ids: list[UUID],
    ) -> tuple[list[UserDocument], list[KnowledgeFileBatchFailure]]:
        normalized_ids: list[UUID] = []
        seen_ids: set[UUID] = set()
        for file_id in file_ids:
            if file_id in seen_ids:
                continue
            seen_ids.add(file_id)
            normalized_ids.append(file_id)

        if not normalized_ids:
            raise HTTPException(status_code=400, detail="file_ids must not be empty")

        docs = await self.document_repo.list_owned_by_ids(
            user_id=user_id,
            doc_ids=normalized_ids,
        )
        doc_map = {doc.id: doc for doc in docs}
        resolved_docs: list[UserDocument] = []
        failed: list[KnowledgeFileBatchFailure] = []
        for file_id in normalized_ids:
            doc = doc_map.get(file_id)
            if doc is None:
                failed.append(
                    KnowledgeFileBatchFailure(
                        file_id=file_id,
                        reason=KnowledgeFileBatchFailureReason.NOT_FOUND,
                        message="Document not found",
                    )
                )
                continue
            resolved_docs.append(doc)
        return resolved_docs, failed

    async def _build_breadcrumb(
        self,
        *,
        user_id: UUID,
        parent_id: UUID | None,
    ) -> list[KnowledgeBreadcrumbItem]:
        trail: list[KnowledgeBreadcrumbItem] = [
            KnowledgeBreadcrumbItem(id=None, name="root")
        ]
        if parent_id is None:
            return trail

        chain: list[KnowledgeBreadcrumbItem] = []
        current_id = parent_id
        while current_id is not None:
            folder = await self.folder_repo.get_owned(current_id, user_id)
            if folder is None:
                raise HTTPException(status_code=404, detail="Folder not found")
            chain.append(KnowledgeBreadcrumbItem(id=folder.id, name=folder.name))
            current_id = folder.parent_id

        trail.extend(reversed(chain))
        return trail

    async def _collect_descendant_folder_ids(
        self,
        *,
        user_id: UUID,
        root_id: UUID,
    ) -> list[UUID]:
        collected: list[UUID] = []
        frontier = [root_id]
        while frontier:
            children = await self.folder_repo.list_by_parent_ids(
                user_id=user_id,
                parent_ids=frontier,
            )
            if not children:
                break
            child_ids = [child.id for child in children]
            collected.extend(child_ids)
            frontier = child_ids
        return collected

    async def _delete_document_vectors(self, *, user_id: UUID, doc_id: UUID) -> None:
        if not qdrant_is_configured():
            return
        try:
            await delete_points(
                get_qdrant_client(),
                collection_name=get_kb_user_collection_name(user_id),
                query_filter={
                    "must": [
                        {"key": "user_id", "match": {"value": str(user_id)}},
                        {"key": "doc_id", "match": {"value": str(doc_id)}},
                    ]
                },
            )
        except Exception as exc:  # pragma: no cover - 向量删除失败时不中断 DB 删除
            logger.warning(
                "user_document_delete_points_failed",
                extra={"user_id": str(user_id), "doc_id": str(doc_id), "error": str(exc)},
            )

    @staticmethod
    def _extract_extension(filename: str) -> str:
        if "." not in filename:
            return ""
        return filename.rsplit(".", 1)[-1].strip().lower()

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        if not text:
            return 0
        return max(1, len(text.split()))

    @staticmethod
    def _build_copy_filename(filename: str) -> str:
        clean_name = filename.strip() or "untitled"
        if "." not in clean_name:
            return f"{clean_name}-copy"
        stem, ext = clean_name.rsplit(".", 1)
        return f"{stem}-copy.{ext}"

    @staticmethod
    def _folder_sort_key(item: KnowledgeFolderRead, sort_field: str) -> Any:
        field = sort_field.strip().lower()
        if field == "created_at":
            return item.created_at
        return item.name.lower()

    @staticmethod
    def _file_sort_key(item: KnowledgeFileRead, sort_field: str) -> Any:
        field = sort_field.strip().lower()
        if field == "name":
            return item.name.lower()
        if field == "size":
            return item.size
        if field == "status":
            return item.status
        if field == "chunks":
            return item.chunks if item.chunks is not None else -1
        return item.created_at

    def _to_file_read(self, doc: UserDocument) -> KnowledgeFileRead:
        media_asset = doc.media_asset
        size = int(media_asset.size_bytes) if media_asset else 0
        api_status = _DB_TO_API_STATUS.get(doc.status, "failed")
        chunks = None if api_status == "processing" else int(doc.chunk_count or 0)
        return KnowledgeFileRead(
            id=doc.id,
            name=doc.filename,
            type=self._extract_extension(doc.filename),
            size=size,
            status=api_status,
            chunks=chunks,
            error_message=doc.error_message,
            folder_id=doc.folder_id,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
        )

    @staticmethod
    def _enqueue_index_task(*, doc_id: UUID) -> None:
        celery_app.send_task(
            "app.tasks.document.index_user_document_task",
            args=[str(doc_id)],
        )


__all__ = ["UserDocumentService"]
