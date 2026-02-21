"""
Admin API 路由包
"""

from app.api.v1.admin.assistant_review_route import router as assistant_reviews_router
from app.api.v1.admin.assistant_route import router as assistants_router
from app.api.v1.admin.notification_route import router as notification_router
from app.api.v1.admin.billing_route import router as billing_router
from app.api.v1.admin.conversation_route import router as conversations_router
from app.api.v1.admin.gateway_log_route import router as gateway_logs_router
from app.api.v1.admin.generation_task_route import (
    router as generation_tasks_router,
)
from app.api.v1.admin.knowledge_route import router as knowledge_router
from app.api.v1.admin.plugin_route import router as plugins_router
from app.api.v1.admin.provider_credential_route import (
    router as provider_credential_router,
)
from app.api.v1.admin.provider_instance_route import router as provider_instance_router
from app.api.v1.admin.provider_preset_route import router as provider_preset_router
from app.api.v1.admin.registration_route import router as registration_router
from app.api.v1.admin.settings_route import router as settings_router
from app.api.v1.admin.skill_registry_route import router as skill_registry_router
from app.api.v1.admin.spec_knowledge_review_route import (
    router as spec_knowledge_reviews_router,
)
from app.api.v1.admin.spec_plan_route import router as spec_plans_router
from app.api.v1.admin.memory_route import router as memory_router
from app.api.v1.admin.users_route import router as users_router

from .agent_route import router as agent_router
from .api_keys_route import router as api_keys_router

__all__ = [
    "billing_router",
    "conversations_router",
    "gateway_logs_router",
    "generation_tasks_router",
    "knowledge_router",
    "memory_router",
    "plugins_router",
    "spec_plans_router",
    "agent_router",
    "api_keys_router",
    "assistant_reviews_router",
    "assistants_router",
    "notification_router",
    "provider_credential_router",
    "provider_instance_router",
    "provider_preset_router",
    "registration_router",
    "settings_router",
    "skill_registry_router",
    "spec_knowledge_reviews_router",
    "users_router",
]
