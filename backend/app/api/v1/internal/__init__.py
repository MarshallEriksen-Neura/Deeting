"""内部通道路由聚合（Gateway + Bridge + Conversation 管理）。"""

from app.api.v1.internal.bridge import router as bridge_router
from app.api.v1.internal.gateway import router as gateway_router
from app.api.v1.internal.conversation_route import router as conversation_router

__all__ = ["bridge_router", "gateway_router", "conversation_router"]
