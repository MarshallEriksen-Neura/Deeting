"""内部通道路由聚合（Gateway + Bridge）。"""

from app.api.v1.internal.bridge import router as bridge_router
from app.api.v1.internal.gateway import router as gateway_router

__all__ = ["bridge_router", "gateway_router"]
