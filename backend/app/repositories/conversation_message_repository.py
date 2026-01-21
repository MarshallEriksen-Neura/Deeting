from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import insert as sa_insert
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
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "session_id": session_id,
                    "turn_index": int(turn_index),
                    "role": msg.get("role"),
                    "name": msg.get("name"),
                    "content": msg.get("content", ""),
                    "token_estimate": int(msg.get("token_estimate", 0)),
                    "is_truncated": bool(msg.get("is_truncated", False)),
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
