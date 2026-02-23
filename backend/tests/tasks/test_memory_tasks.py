from __future__ import annotations

import asyncio
import time
import uuid
from unittest.mock import AsyncMock, Mock

from app.tasks import memory_tasks


class _FakeRedis:
    def __init__(self, last_active: float) -> None:
        self.last_active = last_active
        self.deleted_keys: list[str] = []

    async def get(self, _key: str) -> str:
        return str(self.last_active)

    async def delete(self, key: str) -> int:
        self.deleted_keys.append(key)
        return 1


class _FakeConversationService:
    def __init__(self, secretary_id: uuid.UUID) -> None:
        self._secretary_id = secretary_id

    async def load_window(self, _session_id: str) -> dict:
        return {
            "messages": [{"role": "user", "content": "hello"}],
            "meta": {"secretary_id": str(self._secretary_id)},
        }


class _LoopBoundRedis:
    """
    模拟绑定事件循环的异步客户端: 如果在不同 loop 中复用则抛错。
    用于回归测试 celery 任务的 loop 复用策略。
    """

    def __init__(self, last_active: float) -> None:
        self.last_active = last_active
        self._bound_loop_id: int | None = None

    async def get(self, _key: str) -> str:
        loop_id = id(asyncio.get_running_loop())
        if self._bound_loop_id is None:
            self._bound_loop_id = loop_id
        elif self._bound_loop_id != loop_id:
            raise RuntimeError("Event loop is closed")
        return str(self.last_active)

    async def delete(self, _key: str) -> int:
        return 1


class _FakeAsyncSessionContext:
    def __init__(self, session_obj: object) -> None:
        self._session_obj = session_obj

    async def __aenter__(self) -> object:
        return self._session_obj

    async def __aexit__(self, _exc_type, _exc, _tb) -> None:
        return None


def test_process_memory_extraction_returns_redis_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(memory_tasks.cache, "_redis", None)

    result = memory_tasks.process_memory_extraction.run(
        "session-1", str(uuid.uuid4())
    )

    assert result == "redis_unavailable"


def test_process_memory_extraction_uses_async_session_local(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    secretary_id = uuid.uuid4()
    fake_db_session = object()
    fake_redis = _FakeRedis(last_active=time.time() - 600)
    extract_mock = AsyncMock(return_value=None)

    monkeypatch.setattr(memory_tasks.cache, "_redis", fake_redis)
    monkeypatch.setattr(
        "app.services.conversation.service.get_conversation_service",
        lambda: _FakeConversationService(secretary_id),
    )
    monkeypatch.setattr(
        memory_tasks,
        "AsyncSessionLocal",
        lambda: _FakeAsyncSessionContext(fake_db_session),
    )
    monkeypatch.setattr(memory_tasks.memory_extractor, "extract_and_save", extract_mock)

    result = memory_tasks.process_memory_extraction.run("session-2", user_id)

    assert result == "ok"
    extract_mock.assert_awaited_once()
    assert extract_mock.await_args.args[0] == uuid.UUID(user_id)
    assert extract_mock.await_args.args[1] == [{"role": "user", "content": "hello"}]
    assert extract_mock.await_args.kwargs["secretary_id"] == secretary_id
    assert extract_mock.await_args.kwargs["db_session"] is fake_db_session


def test_process_memory_extraction_reuses_worker_event_loop(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    secretary_id = uuid.uuid4()
    fake_db_session = object()
    fake_redis = _LoopBoundRedis(last_active=time.time() - 600)
    extract_mock = AsyncMock(return_value=None)

    monkeypatch.setattr(memory_tasks.cache, "_redis", fake_redis)
    monkeypatch.setattr(
        "app.services.conversation.service.get_conversation_service",
        lambda: _FakeConversationService(secretary_id),
    )
    monkeypatch.setattr(
        memory_tasks,
        "AsyncSessionLocal",
        lambda: _FakeAsyncSessionContext(fake_db_session),
    )
    monkeypatch.setattr(memory_tasks.memory_extractor, "extract_and_save", extract_mock)

    first = memory_tasks.process_memory_extraction.run("session-loop-1", user_id)
    second = memory_tasks.process_memory_extraction.run("session-loop-2", user_id)

    assert first == "ok"
    assert second == "ok"
    assert extract_mock.await_count == 2


def test_process_memory_extraction_retries_when_event_loop_closed(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    secretary_id = uuid.uuid4()
    fake_db_session = object()
    fake_redis = _FakeRedis(last_active=time.time() - 600)
    extract_mock = AsyncMock(return_value=None)
    cache_init_mock = Mock()
    state = {"calls": 0}

    def _run_with_new_loop(coro):
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()

    def _fake_run_async(coro):
        state["calls"] += 1
        if state["calls"] == 1:
            coro.close()
            raise RuntimeError("Event loop is closed")
        return _run_with_new_loop(coro)

    monkeypatch.setattr(memory_tasks, "run_async", _fake_run_async)
    monkeypatch.setattr(memory_tasks.cache, "init", cache_init_mock)
    monkeypatch.setattr(memory_tasks.cache, "_redis", fake_redis)
    monkeypatch.setattr(
        "app.services.conversation.service.get_conversation_service",
        lambda: _FakeConversationService(secretary_id),
    )
    monkeypatch.setattr(
        memory_tasks,
        "AsyncSessionLocal",
        lambda: _FakeAsyncSessionContext(fake_db_session),
    )
    monkeypatch.setattr(memory_tasks.memory_extractor, "extract_and_save", extract_mock)

    result = memory_tasks.process_memory_extraction.run("session-loop-retry", user_id)

    assert result == "ok"
    assert state["calls"] == 2
    cache_init_mock.assert_called_once()
    extract_mock.assert_awaited_once()
