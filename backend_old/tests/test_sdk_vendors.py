from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.models import User
from app.provider.sdk_selector import list_registered_sdk_vendors
from app.schemas.provider_control import ProviderPresetBase
from tests.utils import jwt_auth_headers


def test_registry_contains_built_in_vendors():
    vendors = list_registered_sdk_vendors()
    assert {"openai", "google", "claude", "vertexai"}.issubset(set(vendors))


def test_provider_preset_rejects_unknown_sdk_vendor():
    with pytest.raises(ValueError):
        ProviderPresetBase(
            preset_id="TEST",
            display_name="Test Vendor",
            base_url="https://api.example.com",
            transport="sdk",
            sdk_vendor="unknown",
        )


def test_provider_preset_accepts_vertexai_sdk_vendor():
    preset = ProviderPresetBase(
        preset_id="VERTEXAI_TEST",
        display_name="Vertex AI Test",
        base_url="https://us-central1-aiplatform.googleapis.com/",
        transport="sdk",
        sdk_vendor="vertexai",
        chat_completions_path="/v1/chat/completions",
    )
    assert preset.sdk_vendor == "vertexai"


def test_sdk_vendor_route_returns_registry(app_with_inmemory_db):
    app, SessionLocal = app_with_inmemory_db
    with SessionLocal() as session:
        user = session.query(User).first()
        assert user is not None
        headers = jwt_auth_headers(str(user.id))

    with TestClient(app, base_url="http://test") as client:
        resp = client.get("/providers/sdk-vendors", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert {"openai", "google", "claude", "vertexai"}.issubset(set(body["vendors"]))
    assert body["total"] >= 4
