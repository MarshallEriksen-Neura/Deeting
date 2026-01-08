from __future__ import annotations

from sqlalchemy import select

from app.models import User
from app.provider.config import load_provider_configs
from app.schemas.provider_control import (
    ProviderPresetCreateRequest,
    UserProviderCreateRequest,
)
from app.services.provider_preset_service import create_provider_preset
from app.services.user_provider_service import create_private_provider
from app.repositories.agent_task_repository import list_tasks
from app.models.agent_task import AgentTaskType


def _first_user(session):
    return session.execute(select(User).limit(1)).scalars().first()


def test_create_private_provider_inherits_preset(db_session):
    # 准备预设
    preset_payload = ProviderPresetCreateRequest(
        preset_id="openai",
        display_name="OpenAI",
        description="OpenAI default preset",
        provider_type="native",
        transport="http",
        base_url="https://api.openai.com",
        models_path="/v1/models",
        messages_path="/v1/messages",
        chat_completions_path="/v1/chat/completions",
        responses_path="/v1/responses",
        model_list_config={"endpoint": "/v1/models", "selector": "data[*]", "fields": {"id": "id"}},
    )
    create_provider_preset(db_session, preset_payload)

    owner = _first_user(db_session)
    provider_payload = UserProviderCreateRequest(
        preset_id="openai",
        name="my-openai",
        api_key="sk-test",
    )

    provider = create_private_provider(db_session, owner.id, provider_payload)

    assert provider.preset_id == "openai"
    assert provider.preset_uuid is not None

    configs = load_provider_configs(session=db_session, user_id=owner.id, is_superuser=True)
    created_cfg = next(c for c in configs if c.id == provider.provider_id)
    assert created_cfg.base_url == "https://api.openai.com"
    assert created_cfg.transport == "http"

    # metadata 应被初始化
    from app.repositories.provider_metadata_repository import get_metadata_by_slug
    metadata = get_metadata_by_slug(db_session, provider_slug=provider.provider_id)
    assert metadata is not None
    assert metadata.model_list_config is not None



def test_create_private_provider_allows_base_url_override(db_session):
    preset_payload = ProviderPresetCreateRequest(
        preset_id="claude",
        display_name="Claude",
        provider_type="native",
        transport="http",
        base_url="https://api.anthropic.com",
        messages_path="/v1/messages",
        chat_completions_path="/v1/complete",
        responses_path="/v1/responses",
    )
    create_provider_preset(db_session, preset_payload)

    owner = _first_user(db_session)
    provider_payload = UserProviderCreateRequest(
        preset_id="claude",
        name="custom-claude",
        api_key="sk-test",
        base_url="https://proxy.internal",  # 覆盖预设 base_url
    )
    provider = create_private_provider(db_session, owner.id, provider_payload)

    assert provider.base_url == "https://proxy.internal"
    assert provider.preset_id == "claude"

    configs = load_provider_configs(session=db_session, user_id=owner.id, is_superuser=True)
    created_cfg = next(c for c in configs if c.id == provider.provider_id)
    # 覆盖 base_url 生效
    assert created_cfg.base_url == "https://proxy.internal"
