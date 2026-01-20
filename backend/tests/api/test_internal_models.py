import uuid

import pytest

from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.provider_preset import ProviderPreset

DEFAULT_CAPABILITY_CONFIGS = {
    "chat": {
        "template_engine": "simple_replace",
        "request_template": {
            "model": None,
            "messages": None,
            "stream": None,
            "status_stream": None,
            "temperature": None,
            "max_tokens": None,
            "provider_model_id": None,
            "assistant_id": None,
            "session_id": None,
        },
        "response_transform": {},
        "default_headers": {},
        "default_params": {},
        "async_config": {},
    },
    "image_generation": {
        "template_engine": "simple_replace",
        "request_template": {
            "model": None,
            "prompt": None,
            "negative_prompt": None,
            "width": None,
            "height": None,
            "aspect_ratio": None,
            "num_outputs": None,
            "steps": None,
            "cfg_scale": None,
            "seed": None,
            "sampler_name": None,
            "quality": None,
            "style": None,
            "response_format": None,
            "extra_params": None,
            "provider_model_id": None,
            "session_id": None,
            "request_id": None,
            "encrypt_prompt": None,
        },
        "response_transform": {},
        "default_headers": {},
        "default_params": {},
        "async_config": {},
    },
}


async def _seed_user_internal_provider(session, user_id: uuid.UUID) -> ProviderModel:
    preset = ProviderPreset(
        id=uuid.uuid4(),
        name=f"User Internal OpenAI {uuid.uuid4().hex[:6]}",
        slug=f"openai-user-{uuid.uuid4().hex[:8]}",
        provider="openai",
        base_url="https://api.openai.com",
        auth_type="bearer",
        auth_config={},
        default_headers={},
        default_params={},
        capability_configs=DEFAULT_CAPABILITY_CONFIGS,
        is_active=True,
    )
    session.add(preset)

    instance = ProviderInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        preset_slug=preset.slug,
        name="user-internal-openai",
        description="user internal test instance",
        base_url="https://api.openai.com",
        icon=None,
        credentials_ref="ENV_TEST_KEY",
        priority=0,
        is_enabled=True,
        meta={},
    )
    session.add(instance)

    model = ProviderModel(
        id=uuid.uuid4(),
        instance_id=instance.id,
        capability="chat",
        model_id="gpt-4-user",
        unified_model_id=None,
        display_name="GPT-4 User",
        upstream_path="/v1/chat/completions",
        pricing_config={},
        limit_config={},
        tokenizer_config={},
        routing_config={},
        source="manual",
        extra_meta={},
        weight=100,
        priority=0,
        is_active=True,
    )
    session.add(model)
    await session.commit()
    return model


@pytest.mark.asyncio
async def test_internal_models_includes_user_instances(client, auth_tokens, AsyncSessionLocal, test_user):
    user_id = uuid.UUID(test_user["id"])
    async with AsyncSessionLocal() as session:
        await _seed_user_internal_provider(session, user_id)

    resp = await client.get(
        "/api/v1/internal/models",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    instances = data.get("instances", [])
    ids = {item["id"] for inst in instances for item in inst.get("models", [])}
    assert "gpt-4-user" in ids


@pytest.mark.asyncio
async def test_internal_models_requires_auth(client):
    resp = await client.get("/api/v1/internal/models")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_internal_models_filter_by_capability(client, auth_tokens, AsyncSessionLocal, test_user):
    user_id = uuid.UUID(test_user["id"])
    async with AsyncSessionLocal() as session:
        base_model = await _seed_user_internal_provider(session, user_id)
        image_model = ProviderModel(
            id=uuid.uuid4(),
            instance_id=base_model.instance_id,
            capability="image_generation",
            model_id="sdxl-user",
            unified_model_id=None,
            display_name="SDXL User",
            upstream_path="/v1/images/generations",
            pricing_config={},
            limit_config={},
            tokenizer_config={},
            routing_config={},
            source="manual",
            extra_meta={},
            weight=100,
            priority=0,
            is_active=True,
        )
        session.add(image_model)
        await session.commit()

    resp = await client.get(
        "/api/v1/internal/models?capability=image_generation",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    instances = data.get("instances", [])
    ids = {item["id"] for inst in instances for item in inst.get("models", [])}
    assert "sdxl-user" in ids
    assert "gpt-4-user" not in ids
