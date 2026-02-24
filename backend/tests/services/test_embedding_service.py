from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.providers import embedding as embedding_module
from app.services.providers.embedding import EmbeddingService


class _FakeEmbeddingsAPI:
    def __init__(self) -> None:
        self.called_models: list[str] = []

    async def create(self, *, input, model: str):
        self.called_models.append(model)
        if isinstance(input, list):
            data = [SimpleNamespace(embedding=[0.1, 0.2]) for _ in input]
        else:
            data = [SimpleNamespace(embedding=[0.1, 0.2])]
        return SimpleNamespace(data=data)


class _FakeAsyncOpenAI:
    def __init__(self, api: _FakeEmbeddingsAPI) -> None:
        self.embeddings = api


@pytest.mark.asyncio
async def test_embedding_service_prefers_cached_model_when_not_explicit(monkeypatch):
    fake_api = _FakeEmbeddingsAPI()

    async def _fake_cached_model() -> str:
        return "db-embedding-model"

    monkeypatch.setattr(
        embedding_module,
        "get_cached_embedding_model",
        _fake_cached_model,
    )
    monkeypatch.setattr(
        embedding_module.openai,
        "AsyncOpenAI",
        lambda **kwargs: _FakeAsyncOpenAI(fake_api),
    )

    service = EmbeddingService(config={"api_key": "sk-test", "base_url": "https://example.com"})
    vector = await service.embed_text("hello")

    assert vector == [0.1, 0.2]
    assert fake_api.called_models == ["db-embedding-model"]
    assert service.model == "db-embedding-model"


@pytest.mark.asyncio
async def test_embedding_service_keeps_explicit_model(monkeypatch):
    fake_api = _FakeEmbeddingsAPI()

    async def _fake_cached_model() -> str:
        return "db-embedding-model"

    monkeypatch.setattr(
        embedding_module,
        "get_cached_embedding_model",
        _fake_cached_model,
    )
    monkeypatch.setattr(
        embedding_module.openai,
        "AsyncOpenAI",
        lambda **kwargs: _FakeAsyncOpenAI(fake_api),
    )

    service = EmbeddingService(
        config={
            "api_key": "sk-test",
            "base_url": "https://example.com",
            "model": "explicit-model",
        }
    )
    _ = await service.embed_text("hello")

    assert fake_api.called_models == ["explicit-model"]
    assert service.model == "explicit-model"


@pytest.mark.asyncio
async def test_embedding_service_without_client_still_resolves_cached_model(monkeypatch):
    async def _fake_cached_model() -> str:
        return "db-embedding-model"

    monkeypatch.setattr(
        embedding_module,
        "get_cached_embedding_model",
        _fake_cached_model,
    )

    service = EmbeddingService(config={"vector_size": 8})
    vector = await service.embed_text("hello")

    assert len(vector) == 8
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
