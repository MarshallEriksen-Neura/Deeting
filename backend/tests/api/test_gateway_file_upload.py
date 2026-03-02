import uuid

import httpx
import pytest

from app.deps.external_auth import ExternalPrincipal, get_external_principal
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.provider_preset import ProviderPreset
from main import app

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
        },
        "response_transform": {},
        "default_headers": {},
        "default_params": {},
        "async_config": {},
    }
}


async def _seed_chat_provider(session, user_id: uuid.UUID) -> ProviderModel:
    preset = ProviderPreset(
        id=uuid.uuid4(),
        name=f"OpenAI Files {uuid.uuid4().hex[:6]}",
        slug=f"openai-files-{uuid.uuid4().hex[:8]}",
        provider="openai",
        base_url="https://api.openai.com",
        auth_type="none",
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
        name="openai-files-instance",
        description="test instance for file upload",
        base_url="https://api.openai.com",
        icon=None,
        credentials_ref="dummy-secret-ref",
        priority=0,
        is_enabled=True,
        meta={"protocol": "openai"},
    )
    session.add(instance)

    model = ProviderModel(
        id=uuid.uuid4(),
        instance_id=instance.id,
        capabilities=["chat"],
        model_id="gpt-4-user",
        unified_model_id=None,
        display_name="GPT-4 User",
        upstream_path="chat/completions",
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


def _mock_upstream_client(monkeypatch, handler):
    transport = httpx.MockTransport(handler)

    def _factory(*, timeout=None, http2=True, **kwargs):  # noqa: ARG001
        return httpx.AsyncClient(transport=transport)

    monkeypatch.setattr(
        "app.services.providers.model_file_proxy_service.create_async_http_client",
        _factory,
    )


@pytest.mark.asyncio
async def test_internal_files_upload_success(
    client, auth_tokens, AsyncSessionLocal, test_user, monkeypatch
):
    user_id = uuid.UUID(test_user["id"])
    async with AsyncSessionLocal() as session:
        await _seed_chat_provider(session, user_id)

    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["content_type"] = request.headers.get("content-type", "")
        captured["body"] = request.read()
        return httpx.Response(
            status_code=200,
            json={"id": "file-123", "object": "file", "purpose": "assistants"},
        )

    _mock_upstream_client(monkeypatch, handler)

    response = await client.post(
        "/api/v1/internal/files",
        data={"model": "gpt-4-user", "purpose": "assistants"},
        files={"file": ("demo.pdf", b"%PDF-1.4 test", "application/pdf")},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert response.status_code == 200
    assert response.json()["id"] == "file-123"
    assert captured["url"] == "https://api.openai.com/v1/files"
    assert "multipart/form-data" in captured["content_type"]
    assert b'name="purpose"' in captured["body"]
    assert b"name=\"model\"" not in captured["body"]


@pytest.mark.asyncio
async def test_internal_files_rejects_model_provider_model_mismatch(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    async with AsyncSessionLocal() as session:
        model = await _seed_chat_provider(session, user_id)

    response = await client.post(
        "/api/v1/internal/files",
        data={
            "model": "another-model",
            "provider_model_id": str(model.id),
            "purpose": "assistants",
        },
        files={"file": ("demo.pdf", b"%PDF-1.4 test", "application/pdf")},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "INVALID_REQUEST"
    assert "do not match" in payload["message"]


@pytest.mark.asyncio
async def test_internal_files_requires_file(client, auth_tokens):
    response = await client.post(
        "/api/v1/internal/files",
        data={"model": "gpt-4-user"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert response.status_code == 400
    assert "file is required" in response.json()["detail"]


@pytest.mark.asyncio
async def test_external_files_rejects_model_not_allowed(
    client, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    async with AsyncSessionLocal() as session:
        await _seed_chat_provider(session, user_id)

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_external_principal] = lambda: ExternalPrincipal(
        user_id=test_user["id"],
        scopes=[],
        allowed_models=["gpt-allowed-only"],
    )
    try:
        response = await client.post(
            "/api/v1/external/files",
            data={"model": "gpt-4-user", "purpose": "assistants"},
            files={"file": ("demo.pdf", b"%PDF-1.4 test", "application/pdf")},
        )
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)

    assert response.status_code == 403
    payload = response.json()
    assert payload["code"] == "MODEL_NOT_ALLOWED"


@pytest.mark.asyncio
async def test_external_files_upload_success(
    client, AsyncSessionLocal, test_user, monkeypatch
):
    user_id = uuid.UUID(test_user["id"])
    async with AsyncSessionLocal() as session:
        await _seed_chat_provider(session, user_id)

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.openai.com/v1/files"
        return httpx.Response(
            status_code=200,
            json={"id": "file-ext-1", "object": "file", "purpose": "assistants"},
        )

    _mock_upstream_client(monkeypatch, handler)

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_external_principal] = lambda: ExternalPrincipal(
        user_id=test_user["id"],
        scopes=[],
        allowed_models=["gpt-4-user"],
    )
    try:
        response = await client.post(
            "/api/v1/external/files",
            data={"model": "gpt-4-user", "purpose": "assistants"},
            files={"file": ("demo.pdf", b"%PDF-1.4 test", "application/pdf")},
        )
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)

    assert response.status_code == 200
    assert response.json()["id"] == "file-ext-1"
