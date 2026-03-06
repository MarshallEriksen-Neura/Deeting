from uuid import uuid4

import pytest

from app.models import ProviderPreset


@pytest.mark.asyncio
async def test_admin_provider_presets_exposes_full_sync_fields(
    client, auth_tokens, AsyncSessionLocal
):
    slug = f"desktop-sync-{uuid4().hex[:8]}"
    async with AsyncSessionLocal() as session:
        session.add(
            ProviderPreset(
                name="Desktop Sync Provider",
                slug=slug,
                provider="custom",
                category="Cloud API",
                base_url="https://api.example.com",
                url_template="https://{resource}.example.com",
                auth_type="api_key",
                auth_config={"header": "x-api-key"},
                default_headers={"X-Test": "1"},
                default_params={"temperature": 0.2},
                capability_configs={
                    "chat": {
                        "template_engine": "simple_replace",
                        "request_template": {"model": None, "messages": None},
                        "response_transform": {},
                    }
                },
                theme_color="#123456",
                template_engine="simple_replace",
                response_transform={"content_path": "choices.0.message.content"},
                version=3,
                is_active=True,
            )
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    response = await client.get("/api/v1/admin/provider-presets", headers=headers)
    assert response.status_code == 200

    item = next(p for p in response.json() if p["slug"] == slug)
    assert item["template_engine"] == "simple_replace"
    assert item["response_transform"]["content_path"] == "choices.0.message.content"
    assert item["auth_type"] == "api_key"
    assert item["auth_config"]["header"] == "x-api-key"
    assert item["default_headers"]["X-Test"] == "1"
    assert item["default_params"]["temperature"] == 0.2
    assert item["capability_configs"]["chat"]["template_engine"] == "simple_replace"
    assert item["version"] == 3
