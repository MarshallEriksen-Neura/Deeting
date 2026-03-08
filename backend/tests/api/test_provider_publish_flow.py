import uuid

import pytest
from sqlalchemy import select

from app.models.provider_preset import ProviderPreset
from tests.utils.provider_protocol_profiles import build_protocol_profiles

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
}


async def _seed_preset(session, slug: str = "openai") -> None:
    existing = (
        await session.execute(
            select(ProviderPreset.slug).where(ProviderPreset.slug == slug)
        )
    ).scalar_one_or_none()
    if existing:
        return

    session.add(
        ProviderPreset(
            id=uuid.uuid4(),
            name="OpenAI",
            slug=slug,
            provider="openai",
            base_url="https://api.openai.com",
            auth_type="bearer",
            auth_config={"secret_ref_id": "ENV_OPENAI_KEY"},
            protocol_schema_version="2026-03-07",
            protocol_profiles=build_protocol_profiles(
                provider="openai",
                capability_configs=DEFAULT_CAPABILITY_CONFIGS,
            ),
            is_active=True,
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_admin_publish_controls_user_visibility_and_write_access(
    client,
    admin_tokens,
    auth_tokens,
    AsyncSessionLocal,
):
    async with AsyncSessionLocal() as session:
        await _seed_preset(session)

    admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}
    user_headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    create_resp = await client.post(
        "/api/v1/admin/provider-instances",
        json={
            "preset_slug": "openai",
            "name": "admin-public-candidate",
            "base_url": "https://api.openai.com",
            "credentials_ref": "ENV_OPENAI_KEY",
            "is_enabled": True,
            "is_public": False,
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 201
    instance_id = create_resp.json()["id"]

    before_publish = await client.get("/api/v1/providers/instances", headers=user_headers)
    assert before_publish.status_code == 200
    before_ids = {row["id"] for row in before_publish.json()}
    assert instance_id not in before_ids

    sync_resp = await client.post(
        f"/api/v1/admin/provider-instances/{instance_id}/models:sync",
        json={
            "models": [
                {
                    "capabilities": ["chat"],
                    "model_id": "gpt-4o-mini-public",
                    "upstream_path": "chat/completions",
                    "display_name": "GPT-4o Mini Public",
                    "source": "manual",
                }
            ]
        },
        headers=admin_headers,
    )
    assert sync_resp.status_code == 200
    models = sync_resp.json()
    assert len(models) == 1
    provider_model_id = models[0]["id"]

    publish_resp = await client.patch(
        f"/api/v1/admin/provider-instances/{instance_id}",
        json={"is_public": True},
        headers=admin_headers,
    )
    assert publish_resp.status_code == 200
    assert publish_resp.json()["is_public"] is True

    after_publish = await client.get("/api/v1/providers/instances", headers=user_headers)
    assert after_publish.status_code == 200
    after_ids = {row["id"] for row in after_publish.json()}
    assert instance_id in after_ids

    models_resp = await client.get(
        f"/api/v1/providers/instances/{instance_id}/models",
        headers=user_headers,
    )
    assert models_resp.status_code == 200
    assert {item["model_id"] for item in models_resp.json()} == {"gpt-4o-mini-public"}

    internal_models_resp = await client.get("/api/v1/internal/models", headers=user_headers)
    assert internal_models_resp.status_code == 200
    internal_model_ids = {
        item["id"]
        for instance in internal_models_resp.json().get("instances", [])
        for item in instance.get("models", [])
    }
    assert "gpt-4o-mini-public" in internal_model_ids

    available_models_resp = await client.get(
        "/api/v1/models/available",
        headers=user_headers,
    )
    assert available_models_resp.status_code == 200
    assert "gpt-4o-mini-public" in set(available_models_resp.json().get("items", []))

    # 普通用户对公开实例仅可读，不可修改模型
    forbidden_update = await client.patch(
        f"/api/v1/providers/models/{provider_model_id}",
        json={"is_active": False},
        headers=user_headers,
    )
    assert forbidden_update.status_code == 403
