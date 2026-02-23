from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, Mock

from app.tasks import conversation


def _run_with_new_loop(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_conversation_summary_idle_check_retries_when_loop_mismatch(monkeypatch) -> None:
    state = {"calls": 0}
    cache_init_mock = Mock()
    reset_loop_mock = Mock()
    idle_runner_mock = AsyncMock(return_value="queued")

    def _fake_run_async(coro):
        state["calls"] += 1
        if state["calls"] == 1:
            coro.close()
            raise RuntimeError(
                "got Future <Future pending> attached to a different loop"
            )
        return _run_with_new_loop(coro)

    monkeypatch.setattr(conversation, "run_async", _fake_run_async)
    monkeypatch.setattr(conversation, "reset_loop", reset_loop_mock)
    monkeypatch.setattr(conversation.cache, "init", cache_init_mock)
    monkeypatch.setattr(conversation, "_run_summary_idle_check", idle_runner_mock)

    result = conversation.conversation_summary_idle_check("session-loop-retry")

    assert result == "queued"
    assert state["calls"] == 2
    reset_loop_mock.assert_called_once()
    cache_init_mock.assert_called_once()
    idle_runner_mock.assert_awaited_once_with("session-loop-retry")


def test_conversation_summarize_retries_when_loop_mismatch(monkeypatch) -> None:
    state = {"calls": 0}
    cache_init_mock = Mock()
    reset_loop_mock = Mock()
    summarize_runner_mock = AsyncMock(return_value="ok")

    def _fake_run_async(coro):
        state["calls"] += 1
        if state["calls"] == 1:
            coro.close()
            raise RuntimeError("Event loop is closed")
        return _run_with_new_loop(coro)

    monkeypatch.setattr(conversation, "run_async", _fake_run_async)
    monkeypatch.setattr(conversation, "reset_loop", reset_loop_mock)
    monkeypatch.setattr(conversation.cache, "init", cache_init_mock)
    monkeypatch.setattr(conversation, "_run_summarize", summarize_runner_mock)

    result = conversation.conversation_summarize("session-loop-retry")

    assert result == "ok"
    assert state["calls"] == 2
    reset_loop_mock.assert_called_once()
    cache_init_mock.assert_called_once()
    summarize_runner_mock.assert_awaited_once_with("session-loop-retry")
