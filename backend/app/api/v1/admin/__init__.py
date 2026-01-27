"""
Admin API 路由包
"""
from .agent_route import router as agent_router
from .api_keys_route import router as api_keys_router

from app.api.v1.admin.users_route import router as users_router
from app.api.v1.admin.assistant_route import router as assistants_router
from app.api.v1.admin.assistant_review_route import router as assistant_reviews_router
from app.api.v1.admin.registration_route import router as registration_router
from app.api.v1.admin.discovery_route import router as discovery_router
from app.api.v1.admin.provider_instance_route import router as provider_instance_router
from app.api.v1.admin.provider_credential_route import router as provider_credential_router
from app.api.v1.admin.provider_preset_route import router as provider_preset_router
from app.api.v1.admin.notification_route import router as notification_router
from app.api.v1.admin.settings_route import router as settings_router
from app.api.v1.admin.spec_knowledge_review_route import router as spec_knowledge_reviews_router

__all__ = [
    "agent_router",
    "api_keys_router",
    "users_router",
    "assistants_router",
    "assistant_reviews_router",
    "registration_router",
    "discovery_router",
    "provider_instance_router",
    "provider_credential_router",
    "provider_preset_router",
    "notification_router",
    "settings_router",
    "spec_knowledge_reviews_router",
]
