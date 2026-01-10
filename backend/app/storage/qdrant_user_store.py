from __future__ import annotations

import logging
from typing import Tuple
from uuid import UUID

import httpx

from app.storage.qdrant_kb_collections import get_kb_user_collection_name
from app.storage.qdrant_kb_store import ensure_collection_vector_size, QDRANT_DEFAULT_VECTOR_NAME

logger = logging.getLogger(__name__)


async def ensure_user_collection(
    client: httpx.AsyncClient,
    *,
    user_id: UUID | str,
    embedding_model: str | None,
    vector_size: int,
    fail_open: bool = True,
    vector_name: str = QDRANT_DEFAULT_VECTOR_NAME,
) -> Tuple[str, bool]:
    """
    确保用户私有 collection 存在且维度匹配。

    返回 (collection_name, degraded)
    - degraded=True 表示发生错误且在 fail-open 下被忽略（未保证集合可用）。
    """
    collection_name = get_kb_user_collection_name(user_id, embedding_model=embedding_model)
    try:
        await ensure_collection_vector_size(
            client,
            collection_name=collection_name,
            vector_size=vector_size,
            vector_name=vector_name,
        )
        return collection_name, False
    except Exception as exc:  # pragma: no cover - 防御性兜底
        logger.warning(
            "qdrant ensure_user_collection failed",
            extra={
                "collection": collection_name,
                "vector_size": vector_size,
                "embedding_model": embedding_model,
                "fail_open": fail_open,
            },
            exc_info=exc,
        )
        if fail_open:
            return collection_name, True
        raise


__all__ = ["ensure_user_collection"]
