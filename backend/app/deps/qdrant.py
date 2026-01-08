from __future__ import annotations

import httpx
from fastapi import Depends

from app.qdrant_client import QdrantNotConfigured, get_qdrant_client, qdrant_is_configured


async def get_qdrant() -> httpx.AsyncClient:
    """FastAPI 依赖，返回共享的 Qdrant AsyncClient。"""

    if not qdrant_is_configured():
        raise QdrantNotConfigured("Qdrant 未启用或未配置")
    return get_qdrant_client()


QdrantClientDep = Depends(get_qdrant)


__all__ = ["get_qdrant", "QdrantClientDep"]
