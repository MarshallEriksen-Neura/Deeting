"""
v1 路由聚合
"""

from app.api.v1.admin import api_keys_router as admin_api_keys_router
from app.api.v1.admin import users_router as admin_users_router
from app.api.v1.admin import assistants_router as admin_assistants_router
from app.api.v1.admin import registration_router as admin_registration_router
from app.api.v1.admin import provider_instance_router as admin_provider_instance_router
from app.api.v1.admin import provider_credential_router as admin_provider_credential_router
from app.api.v1.admin import provider_preset_router as admin_provider_preset_router
from app.api.v1.admin import discovery_router as admin_discovery_router
from app.api.v1.auth_route import router as auth_router
from app.api.v1.user_api_keys_route import router as user_api_keys_router, models_router as available_models_router
from app.api.v1.external.gateway import router as external_gateway_router
from app.api.v1.internal import bridge_router as internal_bridge_router
from app.api.v1.internal import gateway_router as internal_gateway_router
from app.api.v1.media_routes import router as media_router
from app.api.v1.users_route import router as users_router
from app.api.v1.providers_route import router as provider_router
from app.api.v1.gateway_logs_route import router as gateway_logs_router

__all__ = [
    "admin_api_keys_router",
    "admin_users_router",
    "admin_assistants_router",
    "admin_registration_router",
    "admin_provider_instance_router",
    "admin_provider_credential_router",
    "admin_provider_preset_router",
    "admin_discovery_router",
    "auth_router",
    "user_api_keys_router",
    "available_models_router",
    "external_gateway_router",
    "internal_bridge_router",
    "internal_gateway_router",
    "media_router",
    "users_router",
    "provider_router",
    "gateway_logs_router",
]
