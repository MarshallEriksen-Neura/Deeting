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

