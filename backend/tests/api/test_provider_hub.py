import pytest


@pytest.mark.asyncio
async def test_provider_hub_returns_fixture_when_db_empty(client, auth_tokens):
    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    resp = await client.get("/api/v1/providers/hub", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    providers = data.get("providers", [])
    assert len(providers) >= 6
    slugs = {p["slug"] for p in providers}
    assert "openai" in slugs and "azure" in slugs
    stats = data.get("stats", {})
    assert stats.get("total") == len(providers)


@pytest.mark.asyncio
async def test_provider_hub_marks_connected_after_instance_created(client, auth_tokens):
    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    create_payload = {
        "preset_slug": "openai",
        "name": "my-openai",
        "base_url": "https://api.openai.com",
        "icon": None,
        "credentials_ref": "ENV_OPENAI_KEY",
        "channel": "external",
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
    assert len(openai_card.get("instances", [])) == 1
