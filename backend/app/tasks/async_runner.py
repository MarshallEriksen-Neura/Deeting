from __future__ import annotations

import asyncio
import atexit
import threading
from collections.abc import Coroutine
from typing import Any

_loop_local = threading.local()
_LOOP_ERROR_MARKERS = (
    "Event loop is closed",
    "attached to a different loop",
)


def _close_thread_loop() -> None:
    loop = getattr(_loop_local, "loop", None)
    if loop and not loop.is_closed():
        loop.close()
    _loop_local.loop = None


def reset_loop() -> None:
    """重置当前线程复用的事件循环。"""
    _close_thread_loop()


def is_loop_error(exc: BaseException) -> bool:
    """识别需要触发 loop 重建的跨循环错误。"""
    message = str(exc)
    return any(marker in message for marker in _LOOP_ERROR_MARKERS)


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
