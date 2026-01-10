"""
事务感知的 Celery 任务调度器

确保 Celery 任务只在数据库事务成功提交后才执行，避免：
- 事务回滚但任务已发送
- 任务执行时数据尚未提交导致查询不到数据
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import event

if TYPE_CHECKING:
    from celery import Task
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class TransactionAwareCelery:
    """事务感知的 Celery 任务调度器"""

    def __init__(self, session: AsyncSession):
        """
        Args:
            session: SQLAlchemy AsyncSession
        """
        self.session = session
        self._pending_tasks: list[tuple[Task, tuple, dict]] = []

    def delay_after_commit(
        self,
        task: Task,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        """
        在事务提交后延迟执行任务

        Args:
            task: Celery 任务对象
            *args: 任务位置参数
            **kwargs: 任务关键字参数

        Example:
            scheduler = TransactionAwareCelery(session)
            scheduler.delay_after_commit(record_usage_task, tenant_id, amount)
            await session.commit()  # 任务会在这里提交后执行
        """
        self._pending_tasks.append((task, args, kwargs))

        # 注册 after_commit 钩子（只注册一次）
        if len(self._pending_tasks) == 1:
            self._register_hooks()

    def apply_async_after_commit(
        self,
        task: Task,
        args: tuple | None = None,
        kwargs: dict | None = None,
        **options: Any,
    ) -> None:
        """
        在事务提交后异步执行任务（支持更多选项）

        Args:
            task: Celery 任务对象
            args: 任务位置参数
            kwargs: 任务关键字参数
            **options: Celery apply_async 选项（countdown, eta, expires 等）

        Example:
            scheduler = TransactionAwareCelery(session)
            scheduler.apply_async_after_commit(
                sync_quota_task,
                args=(tenant_id,),
                countdown=60,  # 60 秒后执行
            )
            await session.commit()
        """
        merged_kwargs = kwargs or {}
        merged_kwargs["__celery_options__"] = options
        self._pending_tasks.append((task, args or (), merged_kwargs))

        if len(self._pending_tasks) == 1:
            self._register_hooks()

    def _register_hooks(self) -> None:
        """注册事务钩子"""

        @event.listens_for(self.session.sync_session, "after_commit", once=True)
        def _on_commit(_session):  # noqa: ANN001
            """事务提交后执行所有待处理任务"""
            for task, args, kwargs in self._pending_tasks:
                try:
                    # 提取 Celery 选项
                    celery_options = kwargs.pop("__celery_options__", None)

                    if celery_options:
                        task.apply_async(args=args, kwargs=kwargs, **celery_options)
                        logger.debug(
                            "transaction_celery_task_scheduled task=%s args=%s kwargs=%s options=%s",
                            task.name,
                            args,
                            kwargs,
                            celery_options,
                        )
                    else:
                        task.delay(*args, **kwargs)
                        logger.debug(
                            "transaction_celery_task_scheduled task=%s args=%s kwargs=%s",
                            task.name,
                            args,
                            kwargs,
                        )
                except Exception as exc:
                    logger.error(
                        "transaction_celery_task_schedule_failed task=%s err=%s",
                        task.name if hasattr(task, "name") else str(task),
                        exc,
                    )

            self._pending_tasks.clear()

        @event.listens_for(self.session.sync_session, "after_rollback", once=True)
        def _on_rollback(_session):  # noqa: ANN001
            """事务回滚时清空待处理任务"""
            if self._pending_tasks:
                logger.info(
                    "transaction_celery_tasks_cancelled count=%d",
                    len(self._pending_tasks),
                )
                self._pending_tasks.clear()


def get_transaction_scheduler(session: AsyncSession) -> TransactionAwareCelery:
    """
    获取事务感知的任务调度器（便捷函数）

    Args:
        session: SQLAlchemy AsyncSession

    Returns:
        TransactionAwareCelery 实例

    Example:
        scheduler = get_transaction_scheduler(session)
        scheduler.delay_after_commit(my_task, arg1, arg2)
        await session.commit()
    """
    return TransactionAwareCelery(session)
