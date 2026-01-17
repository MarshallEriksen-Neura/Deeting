import pytest
from sqlalchemy import select

from app.models import ProviderPreset


async def _seed_presets(session):
    existing = set(
        (
            await session.execute(
                select(ProviderPreset.slug).where(ProviderPreset.slug.in_(["openai", "azure"]))
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
                default_headers={},
                default_params={},
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
                default_headers={},
                default_params={},
                category="Cloud API",
                theme_color="#0078d4",
            )
        )
    if presets:
        session.add_all(presets)
        await session.commit()


@pytest.mark.asyncio
async def test_provider_hub_returns_presets_from_db(client, auth_tokens, AsyncSessionLocal):
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
async def test_provider_hub_marks_connected_after_instance_created(client, auth_tokens, AsyncSessionLocal):
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
    resp_create = await client.post("/api/v1/providers", json=create_payload, headers=headers)
    assert resp_create.status_code == 201

    resp = await client.get("/api/v1/providers/hub", headers=headers)
    assert resp.status_code == 200
    providers = resp.json().get("providers", [])
    openai_card = next((p for p in providers if p["slug"] == "openai"), None)
    assert openai_card is not None
    assert openai_card["connected"] is True
    assert len(openai_card.get("instances", [])) >= 1
