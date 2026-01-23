import pytest
from httpx import AsyncClient

from app.core.cache import cache
from app.core.cache_keys import CacheKeys


@pytest.mark.asyncio
async def test_internal_chat_cancel_sets_cache(
    client: AsyncClient,
    auth_tokens: dict,
    test_user: dict,
):
    request_id = "req-cancel-001"

    resp = await client.post(
        f"/api/v1/internal/chat/completions/{request_id}/cancel",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["request_id"] == request_id
    assert data["status"] == "canceled"

    cached = await cache.get(CacheKeys.request_cancel("chat", str(test_user["id"]), request_id))
    assert cached is True
