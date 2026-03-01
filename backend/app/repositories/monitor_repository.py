from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, func, select
from sqlalchemy.engine import Result
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.monitor import MonitorExecutionLog, MonitorStatus, MonitorTask
from app.repositories.base import BaseRepository


class MonitorTaskRepository(BaseRepository[MonitorTask]):
    model = MonitorTask

    async def get_by_user(self, user_id: UUID, skip: int = 0, limit: int = 100) -> list[MonitorTask]:
        stmt = (
            select(self.model)
            .where(
                and_(
                    self.model.user_id == user_id,
                    self.model.is_active == True,
                )
            )
            .offset(skip)
            .limit(limit)
        )
        result: Result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_user_count(self, user_id: UUID) -> int:
        stmt = (
            select(func.count())
            .select_from(self.model)
            .where(
                and_(
                    self.model.user_id == user_id,
                    self.model.is_active == True,
                )
            )
        )
        result: Result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def get_user_stats(self, user_id: UUID) -> dict[str, int]:
        stmt = select(
            func.count(self.model.id).label("total_tasks"),
            func.sum(
                case(
                    (self.model.status == MonitorStatus.ACTIVE, 1),
                    else_=0,
                )
            ).label("active_tasks"),
            func.sum(
                case(
                    (self.model.status == MonitorStatus.PAUSED, 1),
                    else_=0,
                )
            ).label("paused_tasks"),
            func.sum(
                case(
                    (self.model.status == MonitorStatus.FAILED_SUSPENDED, 1),
                    else_=0,
                )
            ).label("failed_suspended_tasks"),
            func.coalesce(func.sum(self.model.total_tokens), 0).label("total_tokens"),
        ).where(
            and_(
                self.model.user_id == user_id,
                self.model.is_active == True,
            )
        )
        result: Result = await self.session.execute(stmt)
        row = result.one()
        return {
            "total_tasks": int(row.total_tasks or 0),
            "active_tasks": int(row.active_tasks or 0),
            "paused_tasks": int(row.paused_tasks or 0),
            "failed_suspended_tasks": int(row.failed_suspended_tasks or 0),
            "total_tokens": int(row.total_tokens or 0),
        }

    async def get_active_tasks(self) -> list[MonitorTask]:
        stmt = select(self.model).where(
            and_(
                self.model.status == MonitorStatus.ACTIVE,
                self.model.is_active == True,
            )
        )
        result: Result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_ids(self, task_ids: list[UUID]) -> list[MonitorTask]:
        if not task_ids:
            return []
        stmt = select(self.model).where(self.model.id.in_(task_ids))
        result: Result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_title(self, user_id: UUID, title: str) -> MonitorTask | None:
        stmt = select(self.model).where(
            and_(
                self.model.user_id == user_id,
                self.model.title == title,
                self.model.is_active == True,
            )
        )
        result: Result = await self.session.execute(stmt)
        return result.scalars().first()

    async def update_status(self, task_id: UUID, status: MonitorStatus) -> MonitorTask | None:
        task = await self.get(task_id)
        if task:
            task.status = status
            self.session.add(task)
            await self.session.commit()
            await self.session.refresh(task)
        return task

    async def increment_error_count(self, task_id: UUID) -> int:
        task = await self.get(task_id)
        if task:
            task.error_count += 1
            self.session.add(task)
            await self.session.commit()
            await self.session.refresh(task)
            return task.error_count
        return 0

    async def reset_error_count(self, task_id: UUID) -> None:
        task = await self.get(task_id)
        if task:
            task.error_count = 0
            self.session.add(task)
            await self.session.commit()

    async def update_snapshot(self, task_id: UUID, snapshot: dict[str, Any], tokens_used: int) -> MonitorTask | None:
        task = await self.get(task_id)
        if task:
            task.last_snapshot = snapshot
            task.total_tokens += tokens_used
            self.session.add(task)
            await self.session.commit()
            await self.session.refresh(task)
        return task

    async def update_last_executed(self, task_id: UUID) -> None:
        task = await self.get(task_id)
        if task:
            from app.utils.time_utils import Datetime

            task.last_executed_at = Datetime.now()
            self.session.add(task)
            await self.session.commit()


class MonitorExecutionLogRepository(BaseRepository[MonitorExecutionLog]):
    model = MonitorExecutionLog

    async def get_by_task(self, task_id: UUID, skip: int = 0, limit: int = 50) -> list[MonitorExecutionLog]:
        stmt = (
            select(self.model)
            .where(self.model.task_id == task_id)
            .order_by(self.model.triggered_at.desc())
            .offset(skip)
            .limit(limit)
        )
        result: Result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_task_count(self, task_id: UUID) -> int:
        stmt = select(func.count()).select_from(self.model).where(self.model.task_id == task_id)
        result: Result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def get_total_count_by_user(self, user_id: UUID) -> int:
        stmt = (
            select(func.count(self.model.id))
            .select_from(self.model)
            .join(MonitorTask, MonitorTask.id == self.model.task_id)
            .where(
                and_(
                    MonitorTask.user_id == user_id,
                    MonitorTask.is_active == True,
                )
            )
        )
        result: Result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def create_log(
        self,
        task_id: UUID,
        triggered_at: Any,
        status: str,
        input_data: dict[str, Any] | None = None,
        output_data: dict[str, Any] | None = None,
        tokens_used: int = 0,
        error_message: str | None = None,
    ) -> MonitorExecutionLog:
        log = self.model(
            task_id=task_id,
            triggered_at=triggered_at,
            status=status,
            input_data=input_data,
            output_data=output_data,
            tokens_used=tokens_used,
            error_message=error_message,
        )
        self.session.add(log)
        await self.session.commit()
        await self.session.refresh(log)
        return log
