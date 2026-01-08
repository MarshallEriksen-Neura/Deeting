"""兼容层：保持历史导入路径，实际实现位于 services/vector/qdrant_user_service.py"""

from app.services.vector.qdrant_user_service import (  # noqa: F401
    VectorStoreClient,
    QdrantUserVectorService as QdrantScopedClient,
)

__all__ = ["VectorStoreClient", "QdrantScopedClient"]
