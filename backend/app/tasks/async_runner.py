from __future__ import annotations

import asyncio
import atexit
import threading
from collections.abc import Coroutine
from typing import Any

_loop_local = threading.local()


def _close_thread_loop() -> None:
    loop = getattr(_loop_local, "loop", None)
    if loop and not loop.is_closed():
        loop.close()
    _loop_local.loop = None


def run_async[T](coro: Coroutine[Any, Any, T]) -> T:
    """
    在 Celery worker 线程内复用 event loop。
    避免 asyncio.run() 每次关闭 loop 导致异步客户端跨 loop 复用报错。
    """
    loop = getattr(_loop_local, "loop", None)
    if loop is None or loop.is_closed():
        loop = asyncio.new_event_loop()
        _loop_local.loop = loop
    return loop.run_until_complete(coro)


atexit.register(_close_thread_loop)

