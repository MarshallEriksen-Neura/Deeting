"""
v1 路由聚合
"""

from app.api.v1.admin import api_keys_router as admin_api_keys_router
from app.api.v1.admin import users_router as admin_users_router
from app.api.v1.admin import assistants_router as admin_assistants_router
from app.api.v1.admin import registration_router as admin_registration_router
from app.api.v1.auth_route import router as auth_router
from app.api.v1.external.gateway import router as external_gateway_router
from app.api.v1.internal import bridge_router as internal_bridge_router
from app.api.v1.internal import gateway_router as internal_gateway_router
from app.api.v1.media_routes import router as media_router
from app.api.v1.users_route import router as users_router

__all__ = [
    "admin_api_keys_router",
    "admin_users_router",
    "admin_assistants_router",
    "admin_registration_router",
    "auth_router",
    "external_gateway_router",
    "internal_bridge_router",
    "internal_gateway_router",
    "media_router",
    "users_router",
]
