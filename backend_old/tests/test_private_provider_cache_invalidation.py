from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.deps import get_redis
from app.model_cache import MODELS_CACHE_KEY
from app.models import User
from app.storage.redis_service import PROVIDER_MODELS_KEY_TEMPLATE
from tests.utils import InMemoryRedis, jwt_auth_headers


def _get_single_user(session) -> User:
    user = session.query(User).first()
    assert user is not None
    return user


def test_update_private_provider_invalidates_model_caches(
    client: TestClient, db_session
) -> None:
    user = _get_single_user(db_session)
    user_id = str(user.id)
    headers = jwt_auth_headers(user_id)

    fake_redis = InMemoryRedis()

    async def override_get_redis():
        return fake_redis

    client.app.dependency_overrides[get_redis] = override_get_redis

    payload = {
        "name": "My Provider",
        "base_url": "http://upstream.test",
        "api_key": "sk-test",
        "provider_type": "native",
        "transport": "http",
        "chat_completions_path": "/v1/chat/completions",
    }
    resp = client.post(
        f"/users/{user_id}/private-providers", json=payload, headers=headers
    )
    assert resp.status_code == 201, resp.text
    provider_id = resp.json()["provider_id"]

    # Seed caches to ensure the update endpoint clears them immediately.
    logical_model_key = "llm:logical:test-logical"
    provider_models_key = PROVIDER_MODELS_KEY_TEMPLATE.format(provider_id=provider_id)

    fake_redis._data[MODELS_CACHE_KEY] = "stale"  # type: ignore[attr-defined]
    fake_redis._data[provider_models_key] = "stale"  # type: ignore[attr-defined]
    fake_redis._data[logical_model_key] = "stale"  # type: ignore[attr-defined]

    update_payload = {
        "static_models": [
            {"id": "new-model", "model_id": "new-model", "capabilities": ["chat"]}
        ]
    }
    resp = client.put(
        f"/users/{user_id}/private-providers/{provider_id}",
        json=update_payload,
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    assert MODELS_CACHE_KEY not in fake_redis._data
    assert provider_models_key not in fake_redis._data
    assert logical_model_key not in fake_redis._data


@pytest.fixture(autouse=True)
def _clear_overrides(client: TestClient):
    yield
    client.app.dependency_overrides.pop(get_redis, None)
