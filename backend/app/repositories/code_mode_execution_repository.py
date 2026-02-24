from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select

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


__all__ = ["CodeModeExecutionRepository"]
