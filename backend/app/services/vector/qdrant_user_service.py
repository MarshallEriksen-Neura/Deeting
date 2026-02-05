from __future__ import annotations

import logging
import uuid
from abc import ABC, abstractmethod
from typing import Any

import httpx

from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_store import (
    QDRANT_DEFAULT_VECTOR_NAME,
    delete_points,
    search_points,
    upsert_point,
)
from app.storage.qdrant_user_store import ensure_user_collection

logger = logging.getLogger(__name__)


class VectorStoreClient(ABC):
    """抽象向量存储接口，便于未来切换实现。"""

    @abstractmethod
    async def upsert(
        self, content: str, payload: dict[str, Any] | None = None, id: str | None = None
    ) -> str: ...

    @abstractmethod
    async def search(
        self, query: str, limit: int = 5, score_threshold: float = 0.0
    ) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def delete(self, ids: list[str]) -> None: ...


class QdrantUserVectorService(VectorStoreClient):
    """
    面向“用户私有 + 可插拔”场景的 Qdrant 向量服务：
    - 自动按 user_id + embedding_model 选择/创建集合
    - 支持 fail-open（异常不阻塞主流程）
    - 可注入 EmbeddingService，便于测试与模型切换
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        user_id: uuid.UUID,
        plugin_id: str | None = None,
        embedding_model: str | None = None,
        embedding_service: EmbeddingService | None = None,
        fail_open: bool = True,
        vector_name: str = QDRANT_DEFAULT_VECTOR_NAME,
    ):
        self._client = client
        self._plugin_id = plugin_id
        self._user_id = str(user_id)
        self._embedding_service = embedding_service or EmbeddingService()
        self._embedding_model = embedding_model or getattr(
            self._embedding_service, "model", None
        )
        self._fail_open = fail_open
        self._vector_name = str(vector_name or "").strip() or QDRANT_DEFAULT_VECTOR_NAME
        self._collection_name: str | None = None
        self._log = logger.getChild("QdrantUserVectorService")

    def _refresh_embedding_model(self) -> None:
        current_model = getattr(self._embedding_service, "model", None)
        if current_model:
            self._embedding_model = current_model

    async def _ensure_collection(self, vector_size: int) -> tuple[str, bool]:
        collection, degraded = await ensure_user_collection(
            self._client,
            user_id=self._user_id,
            embedding_model=self._embedding_model,
            vector_size=vector_size,
            fail_open=self._fail_open,
            vector_name=self._vector_name,
        )
        self._collection_name = collection
        return collection, degraded

    def _base_payload(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = extra.copy() if extra else {}
        payload.setdefault("user_id", self._user_id)
        if self._plugin_id:
            payload.setdefault("plugin_id", self._plugin_id)
        if self._embedding_model and "embedding_model" not in payload:
            payload["embedding_model"] = self._embedding_model
        return payload

    def _base_filter(self) -> dict:
        must = [{"key": "user_id", "match": {"value": self._user_id}}]
        if self._plugin_id:
            must.append({"key": "plugin_id", "match": {"value": self._plugin_id}})
        if self._embedding_model:
            must.append(
                {"key": "embedding_model", "match": {"value": self._embedding_model}}
            )
        return {"must": must}

    async def upsert(
        self, content: str, payload: dict[str, Any] | None = None, id: str | None = None
    ) -> str:
        point_id = id or str(uuid.uuid4())
        vector = await self._embedding_service.embed_text(content)
        self._refresh_embedding_model()
        collection, degraded = await self._ensure_collection(len(vector))
        if degraded:
            self._log.warning(
                "upsert degraded; skip write",
                extra={"collection": collection, "user": self._user_id},
            )
            return point_id

        try:
            await upsert_point(
                self._client,
                collection_name=collection,
                point_id=point_id,
                vector=vector,
                payload=self._base_payload({**(payload or {}), "content": content}),
                wait=True,
                vector_name=self._vector_name,
            )
        except Exception as exc:  # pragma: no cover - fail-open path
            if self._fail_open:
                self._log.warning(
                    "upsert failed but ignored",
                    extra={"collection": collection},
                    exc_info=exc,
                )
                return point_id
            raise
        return point_id

    async def search(
        self, query: str, limit: int = 5, score_threshold: float = 0.0
    ) -> list[dict[str, Any]]:
        vector = await self._embedding_service.embed_text(query)
        self._refresh_embedding_model()
        collection, degraded = await self._ensure_collection(len(vector))
        if degraded:
            self._log.warning(
                "search degraded; return empty", extra={"collection": collection}
            )
            return []

        try:
            results = await search_points(
                self._client,
                collection_name=collection,
                vector=vector,
                limit=limit,
                query_filter=self._base_filter(),
                with_payload=True,
                score_threshold=score_threshold,
                vector_name=self._vector_name,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            if self._fail_open:
                self._log.warning(
                    "search failed but ignored",
                    extra={"collection": collection},
                    exc_info=exc,
                )
                return []
            raise

        return [
            {
                "id": item.get("id"),
                "score": item.get("score", 0.0),
                "content": (item.get("payload") or {}).get("content", ""),
                "payload": item.get("payload") or {},
            }
            for item in results
        ]

    async def delete(self, ids: list[str]) -> None:
        if not ids:
            return
        collection = self._collection_name or ""
        try:
            if not collection:
                collection, degraded = await self._ensure_collection(vector_size=1)
                if degraded:
                    self._log.warning(
                        "delete degraded; skip", extra={"collection": collection}
                    )
                    return
            must_filters = [{"key": "user_id", "match": {"value": self._user_id}}]
            if self._plugin_id:
                must_filters.append(
                    {"key": "plugin_id", "match": {"value": self._plugin_id}}
                )
            must_filters.append({"has_id": ids})
            await delete_points(
                self._client,
                collection_name=collection,
                query_filter={"must": must_filters},
                wait=True,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            if self._fail_open:
                self._log.warning(
                    "delete failed but ignored",
                    extra={"collection": collection},
                    exc_info=exc,
                )
                return
            raise


__all__ = ["QdrantUserVectorService", "VectorStoreClient"]
