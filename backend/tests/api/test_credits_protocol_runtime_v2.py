import uuid

import pytest

from app.core.config import settings
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.provider_preset import ProviderPreset
from tests.utils.provider_protocol_profiles import build_protocol_profiles


@pytest.mark.asyncio
async def test_credits_chat_proxy_uses_runtime_v2_for_responses_models(
    client,
    auth_tokens,
    AsyncSessionLocal,
    monkeypatch,
):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")
    captured: dict = {}

    class FakeResp:
        def __init__(self):
            self.status_code = 200
            self.is_success = True
            self._json = {
                "model": "gpt-5.3-codex",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "pong from credits"}],
                    }
                ],
                "usage": {"input_tokens": 4, "output_tokens": 5, "total_tokens": 9},
                "status": "completed",
            }
            self.text = "{}"

        def json(self):
            return self._json

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def request(self, method, url, **kwargs):
            captured["method"] = method
            captured["url"] = url
            captured["headers"] = kwargs.get("headers") or {}
            captured["params"] = kwargs.get("params") or {}
            captured["json"] = kwargs.get("json") or {}
            return FakeResp()

    async def _noop_record_and_adjust(**kwargs):
        return None

    monkeypatch.setattr("app.api.v1.credits_route.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr("app.api.v1.credits_route.record_and_adjust", _noop_record_and_adjust)

    async with AsyncSessionLocal() as session:
        preset = ProviderPreset(
            id=uuid.uuid4(),
            name="OpenAI Responses",
            slug="openai-responses-public",
            provider="openai",
            base_url="https://api.openai.com",
            auth_type="bearer",
            auth_config={},
            protocol_schema_version="2026-03-07",
            protocol_profiles=build_protocol_profiles(
                provider="openai",
                capability_configs={
                    "chat": {
                        "request_builder": {"name": "responses_input_from_items"},
                    }
                },
            ),
            is_active=True,
        )
        session.add(preset)

        instance = ProviderInstance(
            id=uuid.uuid4(),
            user_id=None,
            preset_slug=preset.slug,
            name="public-openai-responses",
            description="public responses model",
            base_url="https://api.openai.com/v1",
            icon=None,
            credentials_ref="db:test-secret",
            priority=0,
            is_enabled=True,
            is_public=True,
            meta={"protocol": "responses"},
        )
        session.add(instance)

        model = ProviderModel(
            id=uuid.uuid4(),
            instance_id=instance.id,
            capabilities=["chat"],
            model_id="gpt-5.3-codex",
            unified_model_id="gpt-5.3-codex",
            display_name="gpt-5.3-codex",
            upstream_path="responses",
            pricing_config={},
            limit_config={},
            tokenizer_config={},
            routing_config={},
            config_override={},
            source="manual",
            extra_meta={},
            weight=100,
            priority=0,
            is_active=True,
        )
        session.add(model)
        await session.commit()

    async def _fake_secret_get(instance, db):
        return "sk-test"

    monkeypatch.setattr("app.api.v1.credits_route._resolve_secret_ref", _fake_secret_get)

    resp = await client.post(
        "/api/v1/credits/chat/completions",
        json={
            "model": "gpt-5.3-codex",
            "messages": [{"role": "user", "content": "hello credits"}],
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["choices"][0]["message"]["content"] == "pong from credits"
    assert captured["method"] == "POST"
    assert captured["url"].endswith("/responses")
    assert captured["json"]["input"] == "hello credits"
    assert "messages" not in captured["json"]
