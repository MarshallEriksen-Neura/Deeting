"""
Admin API 路由包
"""
from app.api.v1.admin.api_keys_route import router as api_keys_router
from app.api.v1.admin.users_route import router as users_router
from app.api.v1.admin.assistant_route import router as assistants_router
from app.api.v1.admin.registration_route import router as registration_router
from app.api.v1.admin.discovery_route import router as discovery_router
from app.api.v1.admin.provider_instance_route import router as provider_instance_router
from app.api.v1.admin.provider_credential_route import router as provider_credential_router
from app.api.v1.admin.provider_preset_route import router as provider_preset_router

__all__ = [
    "api_keys_router",
    "users_router",
    "assistants_router",
    "registration_router",
    "discovery_router",
    "provider_instance_router",
    "provider_credential_router",
    "provider_preset_router",
]
