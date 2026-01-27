"""
v1 路由聚合
"""

from app.api.v1.admin import agent_router as admin_agent_router
from app.api.v1.admin import api_keys_router as admin_api_keys_router
from app.api.v1.admin import users_router as admin_users_router
from app.api.v1.admin import assistants_router as admin_assistants_router
from app.api.v1.admin import assistant_reviews_router as admin_assistant_reviews_router
from app.api.v1.admin import registration_router as admin_registration_router
from app.api.v1.admin import provider_instance_router as admin_provider_instance_router
from app.api.v1.admin import provider_credential_router as admin_provider_credential_router
from app.api.v1.admin import provider_preset_router as admin_provider_preset_router
from app.api.v1.admin import discovery_router as admin_discovery_router
from app.api.v1.admin import notification_router as admin_notification_router
from app.api.v1.admin import settings_router as admin_settings_router
from app.api.v1.auth_route import router as auth_router
from app.api.v1.assistants_route import router as assistants_router
from app.api.v1.notification_ws_route import router as notification_ws_router
from app.api.v1.user_api_keys_route import router as user_api_keys_router, models_router as available_models_router
from app.api.v1.external.gateway import router as external_gateway_router
from app.api.v1.internal import bridge_router as internal_bridge_router
from app.api.v1.internal import gateway_router as internal_gateway_router
from app.api.v1.internal import conversation_router as internal_conversation_router
from app.api.v1.internal import image_generation_router as internal_image_generation_router
from app.api.v1.internal import video_generation_router as internal_video_generation_router
from app.api.v1.public import image_generation_share_router as public_image_share_router
from app.api.v1.media_routes import router as media_router
from app.api.v1.users_route import router as users_router
from app.api.v1.providers_route import router as provider_router
from app.api.v1.gateway_logs_route import router as gateway_logs_router
from app.api.v1.dashboard_route import router as dashboard_router
from app.api.v1.monitoring_route import router as monitoring_router
from app.api.v1.credits_route import router as credits_router
from app.api.v1.spec_agent_route import router as spec_agent_router
from app.api.v1.mcp_route import router as mcp_router
from app.api.v1.endpoints.mcp import router as user_mcp_router
from app.api.v1.settings_route import router as settings_router

__all__ = [
    "admin_agent_router",
    "admin_api_keys_router",
    "admin_users_router",
    "admin_assistants_router",
    "admin_assistant_reviews_router",
    "admin_registration_router",
    "admin_provider_instance_router",
    "admin_provider_credential_router",
    "admin_provider_preset_router",
    "admin_discovery_router",
    "admin_notification_router",
    "admin_settings_router",
    "auth_router",
    "assistants_router",
    "notification_ws_router",
    "user_api_keys_router",
    "available_models_router",
    "external_gateway_router",
    "internal_bridge_router",
    "internal_gateway_router",
    "internal_conversation_router",
    "internal_image_generation_router",
    "internal_video_generation_router",
    "public_image_share_router",
    "media_router",
    "users_router",
    "provider_router",
    "gateway_logs_router",
    "dashboard_router",
    "monitoring_router",
    "credits_router",
    "spec_agent_router",
    "mcp_router",
    "user_mcp_router",
    "settings_router",
]
