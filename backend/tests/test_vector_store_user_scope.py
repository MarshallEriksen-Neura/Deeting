import json
import uuid

import httpx
import pytest

from app.services.vector.qdrant_user_service import QdrantUserVectorService
from app.storage.qdrant_kb_collections import get_kb_user_collection_name


class FakeEmbeddingService:
    def __init__(self, dim: int, model: str = "test-embed"):
        self._vector = [0.1] * dim
        self.model = model

    async def embed_text(self, text: str):  # pragma: no cover - simple async helper
        return list(self._vector)


@pytest.mark.asyncio
async def test_upsert_creates_user_collection_and_writes_points():
    user_id = uuid.uuid4()
    plugin_id = "plugin-test"
    collection_name = get_kb_user_collection_name(user_id, embedding_model="test-embed")

    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == f"/collections/{collection_name}":
            if request.method == "GET":
                return httpx.Response(404, json={})
            if request.method == "PUT":
                body = json.loads(request.content.decode())
                assert body["vectors"]["size"] == 2
                return httpx.Response(200, json={"result": {"status": "ok"}})
        if path == f"/collections/{collection_name}/points":
            body = json.loads(request.content.decode())
            payload = body["points"][0]["payload"]
            assert payload["user_id"] == str(user_id)
            assert payload["plugin_id"] == plugin_id
            assert payload["embedding_model"] == "test-embed"
            return httpx.Response(200, json={"result": {"status": "ok"}})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, base_url="http://qdrant.test")
    vs_client = QdrantUserVectorService(
        client=client,
        plugin_id=plugin_id,
        user_id=user_id,
        embedding_model="test-embed",
        fail_open=False,
        embedding_service=FakeEmbeddingService(dim=2),  # type: ignore[arg-type]
    )

    await vs_client.upsert("hello", payload={}, id="pid-1")
    await client.aclose()

    # 第一次 upsert 应该创建 collection 并写入 point
    assert any(r.method == "GET" and r.url.path == f"/collections/{collection_name}" for r in requests)
    assert any(r.method == "PUT" and r.url.path.endswith("/points") for r in requests)


@pytest.mark.asyncio
async def test_upsert_raises_on_vector_mismatch():
    user_id = uuid.uuid4()
    plugin_id = "plugin-test"
    collection_name = get_kb_user_collection_name(user_id, embedding_model="test-embed")

    async def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == f"/collections/{collection_name}":
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json={"result": {"config": {"params": {"vectors": {"size": 4}}}}},
                )
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, base_url="http://qdrant.test")
    vs_client = QdrantUserVectorService(
        client=client,
        plugin_id=plugin_id,
        user_id=user_id,
        embedding_model="test-embed",
        fail_open=False,
        embedding_service=FakeEmbeddingService(dim=2),  # type: ignore[arg-type]
    )

    with pytest.raises(RuntimeError):
        await vs_client.upsert("hello", payload={}, id="pid-1")

    await client.aclose()
