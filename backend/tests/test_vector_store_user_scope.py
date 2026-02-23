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


class SwitchingEmbeddingService(FakeEmbeddingService):
    def __init__(self, dim: int, initial_model: str, resolved_model: str):
        super().__init__(dim=dim, model=initial_model)
        self._resolved_model = resolved_model

    async def embed_text(self, text: str):
        self.model = self._resolved_model
        return await super().embed_text(text)


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
                assert body["vectors"]["text"]["size"] == 2
                return httpx.Response(200, json={"result": {"status": "ok"}})
        if path == f"/collections/{collection_name}/points":
            body = json.loads(request.content.decode())
            payload = body["points"][0]["payload"]
            assert payload["user_id"] == str(user_id)
            assert payload["plugin_id"] == plugin_id
            assert payload["embedding_model"] == "test-embed"
            assert payload["content"] == "hello"
            assert payload["custom"] == "ok"
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

    await vs_client.upsert(
        "hello",
        payload={
            "user_id": "bad-user",
            "plugin_id": "bad-plugin",
            "embedding_model": "bad-model",
            "content": "bad-content",
            "custom": "ok",
        },
        id="pid-1",
    )
    await client.aclose()

    # 第一次 upsert 应该创建 collection 并写入 point
    assert any(
        r.method == "GET" and r.url.path == f"/collections/{collection_name}"
        for r in requests
    )
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
                    json={
                        "result": {
                            "config": {"params": {"vectors": {"text": {"size": 4}}}}
                        }
                    },
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


@pytest.mark.asyncio
async def test_search_default_threshold_does_not_filter_zero_scores():
    user_id = uuid.uuid4()
    plugin_id = "plugin-test"
    collection_name = get_kb_user_collection_name(user_id, embedding_model="test-embed")
    search_bodies: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == f"/collections/{collection_name}" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "result": {
                        "config": {"params": {"vectors": {"text": {"size": 2}}}}
                    }
                },
            )

        if path == f"/collections/{collection_name}/points/search":
            body = json.loads(request.content.decode())
            search_bodies.append(body)
            return httpx.Response(
                200,
                json={
                    "result": [
                        {
                            "id": "pid-1",
                            "score": 0.0,
                            "payload": {
                                "content": "hello",
                                "user_id": str(user_id),
                                "plugin_id": plugin_id,
                                "embedding_model": "test-embed",
                            },
                        }
                    ]
                },
            )

        return httpx.Response(404)

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://qdrant.test"
    )
    vs_client = QdrantUserVectorService(
        client=client,
        plugin_id=plugin_id,
        user_id=user_id,
        embedding_model="test-embed",
        fail_open=False,
        embedding_service=FakeEmbeddingService(dim=2),  # type: ignore[arg-type]
    )

    results = await vs_client.search("hello", limit=3)
    await client.aclose()

    assert len(results) == 1
    assert results[0]["id"] == "pid-1"
    assert len(search_bodies) == 1
    assert "score_threshold" not in search_bodies[0]


@pytest.mark.asyncio
async def test_search_explicit_threshold_is_forwarded():
    user_id = uuid.uuid4()
    collection_name = get_kb_user_collection_name(user_id, embedding_model="test-embed")
    captured_thresholds: list[float] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == f"/collections/{collection_name}" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "result": {
                        "config": {"params": {"vectors": {"text": {"size": 2}}}}
                    }
                },
            )

        if path == f"/collections/{collection_name}/points/search":
            body = json.loads(request.content.decode())
            captured_thresholds.append(body.get("score_threshold"))
            return httpx.Response(200, json={"result": []})

        return httpx.Response(404)

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://qdrant.test"
    )
    vs_client = QdrantUserVectorService(
        client=client,
        user_id=user_id,
        embedding_model="test-embed",
        fail_open=False,
        embedding_service=FakeEmbeddingService(dim=2),  # type: ignore[arg-type]
    )

    _ = await vs_client.search("hello", limit=3, score_threshold=0.0)
    await client.aclose()

    assert captured_thresholds == [0.0]


@pytest.mark.asyncio
async def test_list_points_uses_refreshed_embedding_model_in_filter():
    user_id = uuid.uuid4()
    collection_name = get_kb_user_collection_name(
        user_id, embedding_model="resolved-embed"
    )
    captured_filter_models: list[str | None] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == f"/collections/{collection_name}" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "result": {
                        "config": {"params": {"vectors": {"text": {"size": 2}}}}
                    }
                },
            )
        if path == f"/collections/{collection_name}/points/scroll":
            body = json.loads(request.content.decode())
            must = ((body.get("filter") or {}).get("must") or [])
            model_value = None
            for cond in must:
                if cond.get("key") == "embedding_model":
                    model_value = ((cond.get("match") or {}).get("value"))
                    break
            captured_filter_models.append(model_value)
            return httpx.Response(
                200,
                json={"result": {"points": [], "next_page_offset": None}},
            )
        return httpx.Response(404)

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://qdrant.test"
    )
    vs_client = QdrantUserVectorService(
        client=client,
        user_id=user_id,
        embedding_model="initial-embed",
        fail_open=False,
        embedding_service=SwitchingEmbeddingService(
            dim=2,
            initial_model="initial-embed",
            resolved_model="resolved-embed",
        ),  # type: ignore[arg-type]
    )

    _items, _cursor = await vs_client.list_points(limit=10, cursor=None)
    await client.aclose()

    assert captured_filter_models == ["resolved-embed"]
