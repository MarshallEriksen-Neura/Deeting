"""
Admin API 路由包
"""
from app.api.v1.admin.api_keys_route import router as api_keys_router
from app.api.v1.admin.users_route import router as users_router
from app.api.v1.admin.assistant_route import router as assistants_router
from app.api.v1.admin.registration_route import router as registration_router

__all__ = ["api_keys_router", "users_router", "assistants_router", "registration_router"]
