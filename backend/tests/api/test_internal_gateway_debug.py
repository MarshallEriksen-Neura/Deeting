import uuid

import pytest

from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.provider_preset import ProviderPreset


async def _seed_internal_provider(session):
    preset = ProviderPreset(
        id=uuid.uuid4(),
        name="OpenAI Debug",
        slug="openai-debug",
        provider="openai",
        base_url="https://api.openai.com",
        auth_type="bearer",
        auth_config={},
        default_headers={},
        default_params={},
        is_active=True,
    )
    session.add(preset)

    instance = ProviderInstance(
        id=uuid.uuid4(),
        user_id=None,
        preset_slug="openai-debug",
        name="internal-openai",
        description="internal test instance",
        base_url="https://api.openai.com",
        icon=None,
        credentials_ref="ENV_TEST_KEY",
        channel="internal",
        priority=0,
        is_enabled=True,
        meta={},
    )
    session.add(instance)

    model = ProviderModel(
        id=uuid.uuid4(),
        instance_id=instance.id,
        capability="chat",
        model_id="gpt-4",
        unified_model_id=None,
        display_name="GPT-4",
        upstream_path="/v1/chat/completions",
        template_engine="simple_replace",
        request_template={},
        response_transform={},
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


@pytest.mark.asyncio
async def test_internal_step_registry(client, auth_tokens):
    resp = await client.get(
        "/api/v1/internal/debug/step-registry",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "steps" in data
    assert "routing" in data["steps"]


@pytest.mark.asyncio
async def test_internal_step_registry_requires_auth(client):
    resp = await client.get("/api/v1/internal/debug/step-registry")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_internal_test_routing(client, auth_tokens, AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        await _seed_internal_provider(session)

    resp = await client.post(
        "/api/v1/internal/debug/test-routing",
        json={"model": "gpt-4", "capability": "chat"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["model"] == "gpt-4"
    assert data["capability"] == "chat"
    assert data["provider"] == "openai"
    assert data["upstream_url"].startswith("https://api.openai.com")


@pytest.mark.asyncio
async def test_internal_test_routing_validation_error(client, auth_tokens):
    resp = await client.post(
        "/api/v1/internal/debug/test-routing",
        json={"model": "", "capability": "chat"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 400
