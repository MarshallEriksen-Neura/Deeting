from uuid import uuid4

import pytest

from app.models import ProviderPreset
from tests.utils.provider_protocol_profiles import build_protocol_profiles


@pytest.mark.asyncio
async def test_admin_provider_presets_exposes_full_sync_fields(
    client, admin_tokens, AsyncSessionLocal
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
                protocol_schema_version="2026-03-07",
                protocol_profiles=build_protocol_profiles(
                    provider="custom",
                    default_headers={"X-Test": "1"},
                    default_params={"temperature": 0.2},
                    capability_configs={
                        "chat": {
                            "template_engine": "simple_replace",
                            "request_template": {"model": None, "messages": None},
                            "response_transform": {
                                "content_path": "choices.0.message.content"
                            },
                        }
                    },
                ),
                theme_color="#123456",
                version=3,
                is_active=True,
            )
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}
    response = await client.get("/api/v1/admin/provider-presets", headers=headers)
    assert response.status_code == 200

    item = next(p for p in response.json() if p["slug"] == slug)
    assert item["auth_type"] == "api_key"
    assert item["auth_config"]["header"] == "x-api-key"
    assert item["protocol_schema_version"] == "2026-03-07"
    assert item["protocol_profiles"]["chat"]["protocol_family"] == "openai_chat"
    assert item["version"] == 3
