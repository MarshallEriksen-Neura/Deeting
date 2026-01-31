from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.agent_plugins.builtins.expert_network import plugin as expert_plugin


class _DummyContext:
    def __init__(self):
        self.db_session = object()
        self.store: dict[str, dict[str, object]] = {}

    def set(self, ns: str, key: str, value: object) -> None:
        self.store.setdefault(ns, {})[key] = value


@pytest.mark.asyncio
async def test_expert_network_skips_on_low_confidence(monkeypatch):
    ctx = _DummyContext()
    service_mock = AsyncMock()
    monkeypatch.setattr(
        expert_plugin,
        "AssistantRetrievalService",
        lambda *_args, **_kwargs: service_mock,
    )

    plugin = expert_plugin.ExpertNetworkPlugin()
    result = await plugin.handle_consult_expert_network(
        intent_query="search",
        confidence=0.2,
        __context__=ctx,
    )

    assert result == []
    assert ctx.store["assistant"]["confidence"] == 0.2
    service_mock.search_candidates.assert_not_called()


@pytest.mark.asyncio
async def test_expert_network_runs_when_confidence_high(monkeypatch):
    ctx = _DummyContext()
    service_mock = AsyncMock()
    service_mock.search_candidates = AsyncMock(
        return_value=[
            {
                "assistant_id": "assistant-1",
                "name": "Expert",
                "summary": "summary",
                "score": 0.9,
            }
        ]
    )
    monkeypatch.setattr(
        expert_plugin,
        "AssistantRetrievalService",
        lambda *_args, **_kwargs: service_mock,
    )

    plugin = expert_plugin.ExpertNetworkPlugin()
    result = await plugin.handle_consult_expert_network(
        intent_query="search",
        confidence=0.95,
        __context__=ctx,
    )

    assert result
    assert ctx.store["assistant"]["id"] == "assistant-1"
    service_mock.search_candidates.assert_awaited_once()
