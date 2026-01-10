from __future__ import annotations

import httpx


async def qdrant_ping(client: httpx.AsyncClient) -> bool:
    """轻量级健康探测，不抛异常，失败返回 False。"""

    try:
        resp = await client.get("/collections")
    except Exception:  # pragma: no cover - 健康探测不传播异常
        return False
    return 200 <= int(resp.status_code) < 300


__all__ = ["qdrant_ping"]
