from __future__ import annotations

import asyncio
from collections import deque
from typing import Deque

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.deps.auth import get_current_active_user_from_token
from app.schemas.notification import (
    NotificationSnapshot,
    NotificationWSInbound,
    NotificationWSOutbound,
)
from app.services.notifications import NotificationInboxService

router = APIRouter(prefix="/notifications", tags=["Notifications"])

_POLL_INTERVAL_SECONDS = 2.0
_SNAPSHOT_LIMIT = 50
_DEDUP_CACHE_SIZE = 1000


def _extract_token(websocket: WebSocket) -> str | None:
    auth = websocket.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:]
    return websocket.query_params.get("token")


class _DedupStore:
    def __init__(self, max_size: int):
        self._queue: Deque[str] = deque()
        self._seen: set[str] = set()
        self._max_size = max_size

    def add(self, value: str) -> bool:
        if value in self._seen:
            return False
        if len(self._queue) >= self._max_size:
            removed = self._queue.popleft()
            self._seen.discard(removed)
        self._queue.append(value)
        self._seen.add(value)
        return True

    def __contains__(self, value: str) -> bool:
        return value in self._seen


@router.websocket("/ws")
async def notifications_ws(websocket: WebSocket) -> None:
    token = _extract_token(websocket)
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with AsyncSessionLocal() as session:
        try:
            user = await get_current_active_user_from_token(token, session)
        except Exception as exc:  # noqa: BLE001
            logger.warning("notification_ws_auth_failed", extra={"error": str(exc)})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await websocket.accept()

        service = NotificationInboxService(session)
        items, unread_count, last_seen_at = await service.fetch_snapshot(
            user.id, limit=_SNAPSHOT_LIMIT
        )
        dedup = _DedupStore(_DEDUP_CACHE_SIZE)
        for item in items:
            dedup.add(str(item.id))

        await websocket.send_json(
            NotificationWSOutbound(
                type="snapshot",
                data=NotificationSnapshot(items=items, unread_count=unread_count),
            ).model_dump(mode="json")
        )

        try:
            while True:
                try:
                    message = await asyncio.wait_for(
                        websocket.receive_text(),
                        timeout=_POLL_INTERVAL_SECONDS,
                    )
                except asyncio.TimeoutError:
                    new_items, new_last_seen = await service.fetch_since(
                        user.id,
                        since=last_seen_at,
                        limit=_SNAPSHOT_LIMIT,
                    )
                    if new_last_seen:
                        last_seen_at = new_last_seen
                    if not new_items:
                        continue

                    unread_count = await service.get_unread_count(user.id)
                    for item in new_items:
                        if not dedup.add(str(item.id)):
                            continue
                        await websocket.send_json(
                            NotificationWSOutbound(
                                type="notification",
                                data={
                                    "item": item.model_dump(mode="json"),
                                    "unread_count": unread_count,
                                },
                            ).model_dump(mode="json")
                        )
                    continue

                try:
                    payload = NotificationWSInbound.model_validate_json(message)
                except ValidationError as exc:
                    await websocket.send_json(
                        NotificationWSOutbound(
                            type="error",
                            data={"message": "Invalid payload", "detail": exc.errors()},
                        ).model_dump(mode="json")
                    )
                    continue

                if payload.type == "ping":
                    await websocket.send_json(
                        NotificationWSOutbound(type="pong", data={"ts": "ok"}).model_dump(mode="json")
                    )
                    continue

                if payload.type == "mark_read":
                    if not payload.notification_id:
                        await websocket.send_json(
                            NotificationWSOutbound(
                                type="error",
                                data={"message": "notification_id required"},
                            ).model_dump(mode="json")
                        )
                        continue
                    await service.mark_read(user.id, payload.notification_id)
                    unread_count = await service.get_unread_count(user.id)
                    await websocket.send_json(
                        NotificationWSOutbound(
                            type="ack",
                            data={
                                "action": "mark_read",
                                "notification_id": str(payload.notification_id),
                                "unread_count": unread_count,
                            },
                        ).model_dump(mode="json")
                    )
                    continue

                if payload.type == "mark_all_read":
                    await service.mark_all_read(user.id)
                    unread_count = await service.get_unread_count(user.id)
                    await websocket.send_json(
                        NotificationWSOutbound(
                            type="ack",
                            data={"action": "mark_all_read", "unread_count": unread_count},
                        ).model_dump(mode="json")
                    )
                    continue

                if payload.type == "clear":
                    await service.clear_all(user.id)
                    await websocket.send_json(
                        NotificationWSOutbound(
                            type="ack",
                            data={"action": "clear", "unread_count": 0},
                        ).model_dump(mode="json")
                    )
        except WebSocketDisconnect:
            logger.info("notification_ws_disconnected", extra={"user_id": str(user.id)})
        except Exception as exc:  # noqa: BLE001
            logger.error("notification_ws_error", extra={"user_id": str(user.id), "error": str(exc)})
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
