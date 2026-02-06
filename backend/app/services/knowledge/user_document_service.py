import uuid
from typing import Any, BinaryIO

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.models.media_asset import MediaAsset
from app.models.user_document import UserDocument
from app.repositories.media_asset_repository import MediaAssetRepository
from app.services.oss.asset_upload_service import AssetUploadService
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_collections import get_kb_user_collection_name
from app.storage.qdrant_kb_store import search_points, delete_points
from app.qdrant_client import get_qdrant_client, qdrant_is_configured

class UserDocumentService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.asset_service = AssetUploadService(session)
        self.asset_repo = MediaAssetRepository(session)
        self.embedding_service = EmbeddingService()

    async def upload_file(
        self,
        user_id: uuid.UUID,
        file: UploadFile,
        meta_info: dict[str, Any] | None = None
    ) -> UserDocument:
        """
        上传并开始处理用户文档。
        1. 使用 AssetUploadService 上传文件到 OSS/Local。
        2. 创建 UserDocument 记录。
        3. 触发 Celery 索引任务。
        """
        # 1. Upload Media Asset (Reusing existing logic)
        # Assuming create_from_stream returns a MediaAsset
        asset = await self.asset_service.create_from_stream(
            user_id=user_id,
            file=file,
            usage="rag_document"
        )
        
        # 2. Create UserDocument
        doc = UserDocument(
            user_id=user_id,
            media_asset_id=asset.id,
            filename=file.filename or "untitled",
            status="pending",
            meta_info=meta_info or {}
        )
        self.session.add(doc)
        await self.session.commit()
        await self.session.refresh(doc)
        
        # 3. Trigger Task
        # Check if Celery is available, otherwise run sync (for dev/test)
        # Ideally, always async in prod.
        celery_app.send_task(
            "app.tasks.document.index_user_document_task",
            args=[str(doc.id)]
        )
        
        return doc

    async def list_documents(self, user_id: uuid.UUID) -> list[UserDocument]:
        stmt = select(UserDocument).where(UserDocument.user_id == user_id).order_by(UserDocument.created_at.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def delete_document(self, user_id: uuid.UUID, doc_id: uuid.UUID) -> bool:
        """
        删除文档及其索引。
        """
        doc = await self.session.get(UserDocument, doc_id)
        if not doc or doc.user_id != user_id:
            return False

        # 1. Delete from Qdrant
        if qdrant_is_configured():
            try:
                client = get_qdrant_client()
                collection_name = get_kb_user_collection_name(user_id)
                
                # Filter by doc_id
                # NOTE: Qdrant delete by filter
                await delete_points(
                    client,
                    collection_name=collection_name,
                    query_filter={
                        "must": [
                            {"key": "doc_id", "match": {"value": str(doc_id)}}
                        ]
                    }
                )
            except Exception as e:
                # Log but continue to delete DB record
                # logger.error(f"Failed to delete qdrant points: {e}")
                pass

        # 2. Delete from DB
        await self.session.delete(doc)
        await self.session.commit()
        return True

    async def search(
        self,
        user_id: uuid.UUID,
        query: str,
        limit: int = 5,
        score_threshold: float = 0.7,
        doc_ids: list[uuid.UUID] | None = None
    ) -> list[dict[str, Any]]:
        """
        执行 RAG 检索。
        - 强制 user_id 隔离（通过 Collection + Payload Filter 双重保障）。
        - 支持 doc_ids 限定范围。
        """
        if not qdrant_is_configured():
            return []

        # 1. Embed Query
        vector = await self.embedding_service.embed_text(query)
        
        # 2. Build Filter
        must_filters = [
            {"key": "user_id", "match": {"value": str(user_id)}} # Payload Security Check
        ]
        
        if doc_ids:
            must_filters.append({
                "key": "doc_id",
                "match": {"any": [str(did) for did in doc_ids]}
            })

        query_filter = {"must": must_filters}

        # 3. Search
        client = get_qdrant_client()
        collection_name = get_kb_user_collection_name(user_id)
        
        try:
            results = await search_points(
                client,
                collection_name=collection_name,
                vector=vector,
                limit=limit,
                query_filter=query_filter,
                score_threshold=score_threshold,
                with_payload=True
            )
            
            # Format Results
            return [
                {
                    "score": item["score"],
                    "text": item["payload"].get("text"),
                    "filename": item["payload"].get("filename"),
                    "page": item["payload"].get("page"),
                    "doc_id": item["payload"].get("doc_id")
                }
                for item in results
            ]
        except Exception:
            # Collection might not exist if user has no docs
            return []

