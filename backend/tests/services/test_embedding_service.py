from __future__ import annotations

import pytest

from app.services.providers import embedding as embedding_module
from app.services.providers.embedding import EmbeddingService


@pytest.mark.asyncio
async def test_embedding_service_prefers_cached_model_when_not_explicit(monkeypatch):
    captured: dict[str, object] = {}

    async def _fake_cached_model() -> str:
        return "db-embedding-model"

    async def _fake_resolve_runtime(self, model: str):
        captured["resolved_model"] = model
        return embedding_module._EmbeddingRuntime(
            model=model,
            protocol="openai",
            url="https://example.com/v1/embeddings",
            params={},
            headers={"Authorization": "Bearer test"},
        )

    async def _fake_post(self, runtime, payload):
        captured["payload"] = payload
        return {"data": [{"embedding": [0.1, 0.2]}]}

    monkeypatch.setattr(
        embedding_module,
        "get_cached_embedding_model",
        _fake_cached_model,
    )
    monkeypatch.setattr(
        EmbeddingService,
        "_resolve_runtime_from_provider",
        _fake_resolve_runtime,
    )
    monkeypatch.setattr(
        EmbeddingService,
        "_post_embeddings_request",
        _fake_post,
    )

    service = EmbeddingService()
    vector = await service.embed_text("hello")

    assert vector == [0.1, 0.2]
    assert captured["resolved_model"] == "db-embedding-model"
    assert captured["payload"] == {
        "model": "db-embedding-model",
        "input": "hello",
    }
    assert service.model == "db-embedding-model"


@pytest.mark.asyncio
async def test_embedding_service_keeps_explicit_model(monkeypatch):
    captured: dict[str, object] = {}

    async def _fake_cached_model() -> str:
        return "db-embedding-model"

    async def _fake_post(self, runtime, payload):
        captured["runtime_model"] = runtime.model
        captured["payload"] = payload
        return {"data": [{"embedding": [0.3, 0.4]}]}

    async def _should_not_resolve_provider(self, model: str):
        raise AssertionError(f"unexpected provider resolution for model={model}")

    monkeypatch.setattr(
        embedding_module,
        "get_cached_embedding_model",
        _fake_cached_model,
    )
    monkeypatch.setattr(
        EmbeddingService,
        "_post_embeddings_request",
        _fake_post,
    )
    monkeypatch.setattr(
        EmbeddingService,
        "_resolve_runtime_from_provider",
        _should_not_resolve_provider,
    )

    service = EmbeddingService(
        config={
            "api_key": "sk-test",
            "base_url": "https://example.com",
            "model": "explicit-model",
        }
    )
    vector = await service.embed_text("hello")

    assert vector == [0.3, 0.4]
    assert captured["runtime_model"] == "explicit-model"
    assert captured["payload"] == {"model": "explicit-model", "input": "hello"}
    assert service.model == "explicit-model"


@pytest.mark.asyncio
async def test_embedding_service_explicit_runtime_without_model_uses_cached_model(
    monkeypatch,
):
    captured: dict[str, object] = {}

    async def _fake_cached_model() -> str:
        return "db-embedding-model"

    async def _fake_post(self, runtime, payload):
        captured["runtime_model"] = runtime.model
        captured["payload"] = payload
        return {"data": [{"embedding": [0.5, 0.6]}]}

    async def _should_not_resolve_provider(self, model: str):
        raise AssertionError(f"unexpected provider resolution for model={model}")

    monkeypatch.setattr(
        embedding_module,
        "get_cached_embedding_model",
        _fake_cached_model,
    )
    monkeypatch.setattr(
        EmbeddingService,
        "_post_embeddings_request",
        _fake_post,
    )
    monkeypatch.setattr(
        EmbeddingService,
        "_resolve_runtime_from_provider",
        _should_not_resolve_provider,
    )

    service = EmbeddingService(config={"api_key": "sk-test", "base_url": "https://example.com"})
    vector = await service.embed_text("hello")

    assert vector == [0.5, 0.6]
    assert captured["runtime_model"] == "db-embedding-model"
    assert captured["payload"] == {
        "model": "db-embedding-model",
        "input": "hello",
    }
    assert service.model == "db-embedding-model"


@pytest.mark.asyncio
async def test_embedding_service_raises_when_model_not_configured(monkeypatch):
    async def _fake_cached_model() -> str | None:
        return None

    monkeypatch.setattr(
        embedding_module,
        "get_cached_embedding_model",
        _fake_cached_model,
    )

    service = EmbeddingService(config={"vector_size": 8})
    with pytest.raises(RuntimeError, match="embedding model is not configured"):
        await service.embed_text("hello")


@pytest.mark.asyncio
async def test_embedding_service_raises_when_provider_resolution_fails(monkeypatch):
    async def _fake_cached_model() -> str:
        return "db-embedding-model"

    async def _fake_resolve_runtime(self, model: str):
        raise RuntimeError(f"embedding provider model not found for model_id='{model}'")

    monkeypatch.setattr(
        embedding_module,
        "get_cached_embedding_model",
        _fake_cached_model,
    )
    monkeypatch.setattr(
        EmbeddingService,
        "_resolve_runtime_from_provider",
        _fake_resolve_runtime,
    )

    service = EmbeddingService()
    with pytest.raises(RuntimeError, match="embedding provider model not found"):
        await service.embed_text("hello")
