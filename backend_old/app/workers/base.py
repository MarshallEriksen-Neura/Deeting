"""
Agent 任务运行器基类。

提供统一的任务状态管理、日志记录和异常处理。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.logging_config import logger
from app.models.agent_task import AgentTask, AgentTaskStatus


class AgentTaskRunner:
    """
    Agent 任务运行器基类。

    提供统一的任务状态管理、日志记录和异常处理。
    子类应实现 execute() 方法。

    使用方式:
        class MyCrawlRunner(AgentTaskRunner):
            async def execute(self) -> dict:
                # 实现爬取逻辑
                return {"pages": 5, "chunks": 20}

        runner = MyCrawlRunner(task_id)
        result = await runner.run()
    """

    def __init__(self, task_id: str | UUID, db: Session | None = None):
        """
        初始化任务运行器。

        Args:
            task_id: AgentTask 的 ID
            db: 可选的数据库会话，如果不提供则创建新会话
        """
        self.task_id = str(task_id)
        self._db = db
        self._owns_db = db is None
        self._task: AgentTask | None = None
        self._logs: list[dict] = []

    @property
    def db(self) -> Session:
        """获取数据库会话，必要时创建新会话。"""
        if self._db is None:
            self._db = SessionLocal()
        return self._db

    @property
    def task(self) -> AgentTask:
        """获取当前任务实例。"""
        if self._task is None:
            self._task = self.db.query(AgentTask).filter(AgentTask.id == self.task_id).first()
            if self._task is None:
                raise ValueError(f"Task not found: {self.task_id}")
        return self._task

    def update_status(self, status: AgentTaskStatus, error_message: str | None = None) -> None:
        """
        更新任务状态。

        Args:
            status: 新状态
            error_message: 可选的错误消息
        """
        self.task.status = status.value
        if error_message:
            self.task.error_message = error_message
        self.db.commit()
        logger.info(f"Task {self.task_id} status updated to {status.value}")

    def add_log(self, level: str, message: str, **extra: Any) -> None:
        """
        添加结构化日志。

        Args:
            level: 日志级别 (info, warning, error)
            message: 日志消息
            **extra: 额外的结构化数据
        """
        log_entry = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": level,
            "message": message,
            **extra,
        }
        self._logs.append(log_entry)

        # 同时输出到应用日志
        log_func = getattr(logger, level, logger.info)
        log_func(f"Task {self.task_id}: {message}", extra=extra if extra else None)

    # ---- Step helpers for实时可视化与可续跑 ----
    def _init_steps(self):
        if self.task.steps is None:
            self.task.steps = []
        if self.task.progress is None:
            self.task.progress = 0

    def begin_step(self, name: str, message: str | None = None, progress: int | None = None):
        self._init_steps()
        now = datetime.now(UTC).isoformat()
        step = {
            "name": name,
            "status": "running",
            "started_at": now,
            "message": message,
        }
        if progress is not None:
            step["progress"] = progress
            self.task.progress = progress
        self.task.current_phase = name
        self.task.steps.append(step)
        self.db.commit()
        self.db.refresh(self.task)
        self.add_log("info", f"Step started: {name}", message=message)

    def update_step(self, message: str | None = None, progress: int | None = None, tool_call: dict | None = None):
        if not self.task.steps:
            return
        step = self.task.steps[-1]
        if message:
            step["message"] = message
        if progress is not None:
            step["progress"] = progress
            self.task.progress = progress
        if tool_call is not None:
            step.setdefault("tool_calls", []).append(tool_call)
        self.db.commit()
        self.db.refresh(self.task)
        self.add_log("info", "Step update", step=step)

    def end_step(self, status: str = "succeeded", message: str | None = None, progress: int | None = None):
        if not self.task.steps:
            return
        step = self.task.steps[-1]
        step["status"] = status
        step["ended_at"] = datetime.now(UTC).isoformat()
        if message:
            step["message"] = message
        if progress is not None:
            step["progress"] = progress
            self.task.progress = progress
        if status == "succeeded" and progress is None:
            self.task.progress = max(self.task.progress or 0, 100 if step is self.task.steps[-1] else 0)
        self.db.commit()
        self.db.refresh(self.task)
        self.add_log("info", f"Step ended: {step.get('name')}", status=status)

    def save_logs(self) -> None:
        """将累积的日志保存到任务记录。"""
        existing_logs = self.task.logs or []
        self.task.logs = existing_logs + self._logs
        self.db.commit()

    def set_result_summary(self, summary: dict) -> None:
        """
        设置任务结果摘要。

        Args:
            summary: 结果摘要字典
        """
        self.task.result_summary = summary
        self.db.commit()

    def handle_error(self, error: Exception) -> None:
        """
        处理任务执行错误。

        Args:
            error: 捕获的异常
        """
        error_msg = f"{type(error).__name__}: {error!s}"
        self.add_log("error", f"Task failed: {error_msg}")
        self.update_status(AgentTaskStatus.FAILED, error_message=error_msg)
        self.save_logs()
        logger.exception(f"Task {self.task_id} failed with error")

    async def execute(self) -> dict:
        """
        执行任务的核心逻辑。子类必须实现此方法。

        Returns:
            结果摘要字典
        """
        raise NotImplementedError("Subclasses must implement execute()")

    async def run(self) -> dict | None:
        """
        运行任务，处理状态转换和异常。

        Returns:
            成功时返回结果摘要，失败时返回 None
        """
        try:
            # 标记为运行中
            self.update_status(AgentTaskStatus.RUNNING)
            self.add_log("info", "Task execution started")

            # 执行核心逻辑
            result = await self.execute()

            # 标记为完成
            self.set_result_summary(result)
            self.add_log("info", "Task execution completed", result=result)
            self.update_status(AgentTaskStatus.COMPLETED)
            self.save_logs()

            return result

        except Exception as e:
            self.handle_error(e)
            return None

        finally:
            # 如果我们创建了数据库会话，则关闭它
            if self._owns_db and self._db is not None:
                self._db.close()


__all__ = ["AgentTaskRunner"]
