from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.agent_plugins.builtins.deeting_core_sdk.plugin import DeetingCoreSdkPlugin


class _DummyContext:
    def __init__(self):
        self.db_session = object()
        self.store: dict[str, dict[str, object]] = {}

    def set(self, ns: str, key: str, value: object) -> None:
        self.store.setdefault(ns, {})[key] = value

    def get(self, ns: str, key: str) -> object | None:
        return self.store.get(ns, {}).get(key)


def test_core_sdk_tools_include_assistant_activation_entries():
    plugin = DeetingCoreSdkPlugin()
    tools = plugin.get_tools()
    names = [tool["function"]["name"] for tool in tools]

    assert "search_sdk" in names
    assert "execute_code_plan" in names
    assert "activate_assistant" in names
    assert "deactivate_assistant" in names


@pytest.mark.asyncio
async def test_consult_expert_network_returns_candidates_without_implicit_activation(
    monkeypatch,
):
    ctx = _DummyContext()
    service_mock = AsyncMock()
    service_mock.search_candidates = AsyncMock(
        return_value=[
            {
                "assistant_id": "assistant-1",
                "name": "Expert",
                "summary": "summary",
                "score": 0.95,
            }
        ]
    )
    monkeypatch.setattr(
        "app.agent_plugins.builtins.deeting_core_sdk.plugin.AssistantRetrievalService",
        lambda *_args, **_kwargs: service_mock,
    )

    plugin = DeetingCoreSdkPlugin()
    result = await plugin.handle_consult_expert_network(
        intent_query="need an expert",
        confidence=0.95,
        __context__=ctx,
    )

    assert result["action"] == "consulted"
    assert result["recommended_assistant_id"] == "assistant-1"
    assert ctx.get("assistant", "id") is None
    assert ctx.get("assistant_activation", "last_consult") == result
