from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import insert as sa_insert
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.models.conversation import ConversationMessage
from app.repositories.base import BaseRepository


class ConversationMessageRepository(BaseRepository[ConversationMessage]):
    model = ConversationMessage

    async def bulk_insert_messages(
        self,
        *,
        session_id: uuid.UUID,
        messages: Sequence[dict[str, Any]],
    ) -> int:
        if not messages:
            return 0

        rows: list[dict[str, Any]] = []
        for msg in messages:
            turn_index = msg.get("turn_index")
            if not turn_index:
                continue
            content = msg.get("content")
            meta_info = msg.get("meta_info")
            extras = {
                k: v
                for k, v in msg.items()
                if k
                not in {
                    "role",
                    "content",
                    "name",
                    "token_estimate",
                    "is_truncated",
                    "turn_index",
                    "is_deleted",
                    "parent_message_id",
                    "meta_info",
                    "used_persona_id",
                }
                and v is not None
            }
            if (
                not isinstance(content, str)
                and content is not None
                and "content" not in (meta_info or {})
            ):
                extras["content"] = content
                content = None
            if extras:
                meta_info = {**(meta_info or {}), **extras}
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "session_id": session_id,
                    "turn_index": int(turn_index),
                    "role": msg.get("role"),
                    "name": msg.get("name"),
                    "content": content,
                    "token_estimate": int(msg.get("token_estimate", 0)),
                    "is_truncated": bool(msg.get("is_truncated", False)),
                    "meta_info": meta_info,
                    "used_persona_id": msg.get("used_persona_id"),
                }
            )

        if not rows:
            return 0

        bind = self.session.get_bind()
        dialect = bind.dialect.name if bind else ""
        if dialect == "postgresql":
            stmt = pg_insert(ConversationMessage).values(rows)
        elif dialect == "sqlite":
            stmt = sqlite_insert(ConversationMessage).values(rows)
        else:
            stmt = sa_insert(ConversationMessage).values(rows)

        if hasattr(stmt, "on_conflict_do_nothing"):
            stmt = stmt.on_conflict_do_nothing(
                index_elements=["session_id", "turn_index"]
            )

        result = await self.session.execute(stmt)
        await self.session.commit()
        inserted = result.rowcount if result.rowcount is not None else len(rows)
        return int(inserted)

    async def list_messages(
        self,
        *,
        session_id: uuid.UUID,
        limit: int,
        before_turn: int | None = None,
        include_deleted: bool = False,
        order_desc: bool = True,
    ) -> list[ConversationMessage]:
        stmt = select(ConversationMessage).where(
            ConversationMessage.session_id == session_id
        )
        if not include_deleted:
            stmt = stmt.where(ConversationMessage.is_deleted.is_(False))
        if before_turn is not None:
            stmt = stmt.where(ConversationMessage.turn_index < int(before_turn))
        if order_desc:
            stmt = stmt.order_by(ConversationMessage.turn_index.desc())
        else:
            stmt = stmt.order_by(ConversationMessage.turn_index.asc())
        stmt = stmt.limit(int(limit))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
