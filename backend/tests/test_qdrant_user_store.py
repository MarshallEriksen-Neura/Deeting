import json
import uuid
import httpx
import pytest

from app.storage.qdrant_user_store import ensure_user_collection


@pytest.mark.asyncio
async def test_ensure_user_collection_create_when_missing():
    user = uuid.uuid4()
    collection_name = None

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal collection_name
        if request.method == "GET":
            return httpx.Response(404, json={})
        if request.method == "PUT":
            collection_name = request.url.path.split("/")[-1]
            body = json.loads(request.content.decode())
            assert body["vectors"]["text"]["size"] == 3
            return httpx.Response(200, json={"result": {"status": "ok"}})
        return httpx.Response(400)

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, base_url="http://qdrant.test")

    name, degraded = await ensure_user_collection(
        client,
        user_id=user,
        embedding_model="test-embed",
        vector_size=3,
    )
    await client.aclose()

    assert name == collection_name
    assert degraded is False


@pytest.mark.asyncio
async def test_ensure_user_collection_fail_open():
    user = uuid.uuid4()

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, base_url="http://qdrant.test")

    name, degraded = await ensure_user_collection(
        client,
        user_id=user,
        embedding_model="test-embed",
        vector_size=3,
        fail_open=True,
    )
    await client.aclose()

    assert name is not None
    assert degraded is True
