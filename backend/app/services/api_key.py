"""
API Key 服务的兼容性导入层

为了保持向后兼容，从 providers.api_key 重新导出 ApiKeyService 和相关类。
实际实现在 app.services.providers.api_key 中。
"""

from app.services.providers.api_key import (
    ApiKeyService,
    ApiPrincipal,
    ApiKeyServiceError,
)

__all__ = [
    "ApiKeyService",
    "ApiPrincipal",
    "ApiKeyServiceError",
]
