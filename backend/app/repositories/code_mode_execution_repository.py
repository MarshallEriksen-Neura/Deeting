from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, or_, select

from app.models.code_mode_execution import CodeModeExecution

from .base import BaseRepository


class CodeModeExecutionRepository(BaseRepository[CodeModeExecution]):
    model = CodeModeExecution

    async def create_execution(
        self,
        payload: dict,
        *,
        commit: bool = True,
    ) -> CodeModeExecution:
        record = CodeModeExecution(**payload)
        self.session.add(record)
        if commit:
            await self.session.commit()
            await self.session.refresh(record)
        else:
            await self.session.flush()
        return record

    async def get_by_execution_id(
        self,
        *,
        user_id: UUID,
        execution_id: str,
    ) -> CodeModeExecution | None:
        token = str(execution_id or "").strip()
        if not token:
            return None
        stmt = (
            select(CodeModeExecution)
            .where(CodeModeExecution.user_id == user_id)
            .where(CodeModeExecution.execution_id == token)
            .order_by(CodeModeExecution.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_identifier(
        self,
        identifier: str,
        *,
        user_id: UUID | None = None,
    ) -> CodeModeExecution | None:
        token = str(identifier or "").strip()
        if not token:
            return None

        conditions = [CodeModeExecution.execution_id == token]
        try:
            conditions.append(CodeModeExecution.id == UUID(token))
        except Exception:
            pass

        stmt = select(CodeModeExecution).where(or_(*conditions))
        if user_id is not None:
            stmt = stmt.where(CodeModeExecution.user_id == user_id)
        stmt = stmt.order_by(CodeModeExecution.created_at.desc())

        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def list_by_user(
        self,
        user_id: UUID,
        *,
        status: str | None = None,
        session_id: str | None = None,
        cursor: str | None = None,
        size: int = 20,
    ) -> tuple[list[CodeModeExecution], str | None]:
        """Return executions for *user_id* ordered by created_at DESC.

        Uses cursor-based pagination (cursor = ISO timestamp of last item).
        Returns ``(items, next_cursor)``.
        """
        stmt = (
            select(CodeModeExecution)
            .where(CodeModeExecution.user_id == user_id)
            .order_by(CodeModeExecution.created_at.desc())
        )
        if status:
            stmt = stmt.where(CodeModeExecution.status == status)
        if session_id:
            stmt = stmt.where(CodeModeExecution.session_id == session_id)
        if cursor:
            from datetime import datetime, timezone

            try:
                cursor_dt = datetime.fromisoformat(cursor)
            except (ValueError, TypeError):
                cursor_dt = None
            if cursor_dt is not None:
                stmt = stmt.where(CodeModeExecution.created_at < cursor_dt)

        stmt = stmt.limit(size + 1)
        result = await self.session.execute(stmt)
        rows = list(result.scalars().all())

        next_cursor: str | None = None
        if len(rows) > size:
            rows = rows[:size]
            last = rows[-1]
            next_cursor = last.created_at.isoformat()

        return rows, next_cursor

    async def count_by_user(
        self,
        user_id: UUID,
        *,
        status: str | None = None,
        session_id: str | None = None,
    ) -> int:
        stmt = (
            select(func.count())
            .select_from(CodeModeExecution)
            .where(CodeModeExecution.user_id == user_id)
        )
        if status:
            stmt = stmt.where(CodeModeExecution.status == status)
        if session_id:
            stmt = stmt.where(CodeModeExecution.session_id == session_id)
        result = await self.session.execute(stmt)
        return result.scalar() or 0


__all__ = ["CodeModeExecutionRepository"]
