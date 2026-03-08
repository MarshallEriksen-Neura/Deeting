from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.cache import cache
from app.models import ProviderPreset
from app.models.provider_instance import ProviderInstance
from tests.utils.provider_protocol_profiles import build_protocol_profiles

DEFAULT_PROFILE_CONFIGS = {
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


async def _seed_presets(session):
    existing = set(
        (
            await session.execute(
                select(ProviderPreset.slug).where(
                    ProviderPreset.slug.in_(["openai", "azure"])
                )
            )
        ).scalars()
    )
    presets = []
    if "openai" not in existing:
        presets.append(
            ProviderPreset(
                name="OpenAI",
                slug="openai",
                provider="openai",
                base_url="https://api.openai.com",
                auth_type="bearer",
                auth_config={"secret_ref_id": "ENV_OPENAI_KEY"},
                protocol_schema_version="2026-03-07",
                protocol_profiles=build_protocol_profiles(
                    provider="openai",
                    profile_configs=DEFAULT_PROFILE_CONFIGS,
                ),
                category="Cloud API",
                theme_color="#000000",
            )
        )
    if "azure" not in existing:
        presets.append(
            ProviderPreset(
                name="Azure OpenAI",
                slug="azure",
                provider="azure",
                base_url="https://{resource}.openai.azure.com",
                auth_type="api_key",
                auth_config={"secret_ref_id": "ENV_AZURE_KEY"},
                protocol_schema_version="2026-03-07",
                protocol_profiles=build_protocol_profiles(
                    provider="azure",
                    profile_configs=DEFAULT_PROFILE_CONFIGS,
                ),
                category="Cloud API",
                theme_color="#0078d4",
            )
        )
    if presets:
        session.add_all(presets)
        await session.commit()


@pytest.mark.asyncio
async def test_provider_hub_returns_presets_from_db(
    client, auth_tokens, AsyncSessionLocal
):
    async with AsyncSessionLocal() as session:
        await _seed_presets(session)
    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    resp = await client.get("/api/v1/providers/hub", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    providers = data.get("providers", [])
    assert len(providers) >= 2
    slugs = {p["slug"] for p in providers}
    assert "openai" in slugs and "azure" in slugs
    stats = data.get("stats", {})
    assert stats.get("total") == len(providers)


@pytest.mark.asyncio
async def test_provider_hub_uses_meili_search(
    client, auth_tokens, AsyncSessionLocal, monkeypatch
):
    async with AsyncSessionLocal() as session:
        await _seed_presets(session)

    backend = AsyncMock()
    backend.search_provider_presets.return_value = ["openai"]
    monkeypatch.setattr(
        "app.services.providers.provider_hub_service.get_search_backend",
        lambda: backend,
    )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    resp = await client.get("/api/v1/providers/hub?q=Open", headers=headers)
    assert resp.status_code == 200
    providers = resp.json().get("providers", [])
    slugs = {p["slug"] for p in providers}
    assert slugs == {"openai"}
    backend.search_provider_presets.assert_awaited_once()


@pytest.mark.asyncio
async def test_provider_hub_marks_connected_after_instance_created(
    client, auth_tokens, AsyncSessionLocal
):
    async with AsyncSessionLocal() as session:
        await _seed_presets(session)
    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    create_payload = {
        "preset_slug": "openai",
        "name": "my-openai",
        "base_url": "https://api.openai.com",
        "icon": None,
        "credentials_ref": "ENV_OPENAI_KEY",
        "priority": 0,
        "is_enabled": True,
    }
    resp_create = await client.post(
        "/api/v1/providers", json=create_payload, headers=headers
    )
    assert resp_create.status_code == 201

    resp = await client.get("/api/v1/providers/hub", headers=headers)
    assert resp.status_code == 200
    providers = resp.json().get("providers", [])
    openai_card = next((p for p in providers if p["slug"] == "openai"), None)
    assert openai_card is not None
    assert openai_card["connected"] is True
    assert len(openai_card.get("instances", [])) >= 1


@pytest.mark.asyncio
async def test_provider_instances_includes_health_and_sparkline(
    client, auth_tokens, AsyncSessionLocal
):
    async with AsyncSessionLocal() as session:
        await _seed_presets(session)
        inst = ProviderInstance(
            id=uuid4(),
            preset_slug="openai",
            name="openai-health-check",
            base_url="https://api.openai.com",
            credentials_ref="ENV_OPENAI_KEY",
            priority=0,
            is_enabled=True,
        )
        session.add(inst)
        await session.commit()

        await cache._redis.hset(  # type: ignore[attr-defined]
            f"provider:health:{inst.id}",
            mapping={"status": "healthy", "latency": 187},
        )
        await cache._redis.rpush(  # type: ignore[attr-defined]
            f"provider:health:{inst.id}:history", 160, 170, 180
        )

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    resp = await client.get("/api/v1/providers/instances", headers=headers)

    assert resp.status_code == 200
    rows = resp.json()
    target = next((item for item in rows if item["id"] == str(inst.id)), None)
    assert target is not None
    assert target["health_status"] == "healthy"
    assert target["latency_ms"] == 187
    assert target["sparkline"] == [160, 170, 180]
