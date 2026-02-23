from __future__ import annotations

import asyncio

from app.tasks import async_runner


async def _running_loop_id() -> int:
    return id(asyncio.get_running_loop())


class _LoopBoundClient:
    def __init__(self) -> None:
        self._loop_id: int | None = None

    async def ping(self) -> str:
        loop_id = id(asyncio.get_running_loop())
        if self._loop_id is None:
            self._loop_id = loop_id
        elif self._loop_id != loop_id:
            raise RuntimeError("Event loop is closed")
        return "pong"


def test_run_async_reuses_same_loop_in_worker_thread() -> None:
    first = async_runner.run_async(_running_loop_id())
    second = async_runner.run_async(_running_loop_id())
    assert first == second


def test_run_async_avoids_cross_loop_client_error() -> None:
    client = _LoopBoundClient()
    assert async_runner.run_async(client.ping()) == "pong"
    assert async_runner.run_async(client.ping()) == "pong"


def test_is_loop_error_detects_loop_mismatch_messages() -> None:
    assert async_runner.is_loop_error(RuntimeError("Event loop is closed"))
    assert async_runner.is_loop_error(
        RuntimeError("got Future attached to a different loop")
    )
    assert not async_runner.is_loop_error(RuntimeError("network timeout"))


def test_reset_loop_forces_new_loop_creation() -> None:
    async_runner.run_async(_running_loop_id())
    first_loop = async_runner._loop_local.loop
    async_runner.reset_loop()
    async_runner.run_async(_running_loop_id())
    second_loop = async_runner._loop_local.loop
    assert first_loop is not second_loop
    assert first_loop.is_closed()
