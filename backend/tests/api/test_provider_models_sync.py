import uuid

import pytest

from app.services.providers import provider_instance_service


@pytest.mark.asyncio
async def test_sync_models_accepts_empty_body(client, auth_tokens, monkeypatch):
    """确保同步接口在无请求体时也能通过（走自动探测分支）。"""

    # 准备：创建实例
    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    payload = {
        "preset_slug": "openai",
        "name": "sync-test",
        "base_url": "https://api.openai.com",  # 不会真实访问，后续会 stub
        "credentials_ref": "ENV_OPENAI_KEY",
        "priority": 0,
        "is_enabled": True,
    }

    resp_create = await client.post("/api/v1/providers", json=payload, headers=headers)
    assert resp_create.status_code == 201
    instance_id = resp_create.json()["id"]

    # Stub 上游探测，避免外部请求
    async def fake_fetch_models(self, preset, instance, secret):
        return [{"id": "gpt-4"}, {"id": "gpt-3.5-turbo"}]

    monkeypatch.setattr(
        provider_instance_service.ProviderInstanceService,
        "_fetch_models_from_upstream",
        fake_fetch_models,
    )

    # 调用同步接口，不提供 body
    resp_sync = await client.post(
        f"/api/v1/providers/instances/{instance_id}/models:sync",
        headers=headers,
        params={"preserve_user_overrides": True},
    )

    assert resp_sync.status_code == 200
    data = resp_sync.json()
    assert isinstance(data, list)
    # 应至少返回 stub 的 2 个模型
    assert {m["model_id"] for m in data} == {"gpt-4", "gpt-3.5-turbo"}


@pytest.mark.asyncio
async def test_sync_models_returns_404_when_preset_missing(client, auth_tokens):
    """当实例引用的 preset 不存在时，应返回 404 而非 500。"""

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    payload = {
        "preset_slug": "non-existent-preset",
        "name": "ghost-instance",
        "base_url": "https://api.invalid.local",
        "credentials_ref": "ENV_FAKE_KEY",
        "priority": 0,
        "is_enabled": True,
    }

    resp_create = await client.post("/api/v1/providers", json=payload, headers=headers)
    assert resp_create.status_code == 201
    instance_id = resp_create.json()["id"]

    resp_sync = await client.post(
        f"/api/v1/providers/instances/{instance_id}/models:sync",
        headers=headers,
        params={"preserve_user_overrides": True},
    )

    assert resp_sync.status_code == 404
    assert resp_sync.json().get("detail") == "preset not found"
