import re
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.monitor import MonitorStatus
from app.repositories.monitor_repository import (
    MonitorExecutionLogRepository,
    MonitorTaskRepository,
)
from app.schemas.monitor import MonitorExecutionLogResponse
from app.services.monitor_cron import next_run_after, validate_cron_expr
from app.services.secrets.manager import SecretManager
from app.utils.time_utils import Datetime


_ALLOWED_TOOL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$")


class MonitorService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.task_repo = MonitorTaskRepository(session)
        self.log_repo = MonitorExecutionLogRepository(session)
        self.secret_manager = SecretManager()

    async def create_task(
        self,
        user_id: UUID,
        title: str,
        objective: str,
        cron_expr: str = "0 */6 * * *",
        notify_config: dict[str, Any] | None = None,
        allowed_tools: list[str] | None = None,
        strategy_variants: dict[str, Any] | None = None,
        model_id: str | None = None,
    ) -> dict[str, Any]:
        ok, error = validate_cron_expr(cron_expr)
        if not ok:
            raise ValueError(f"Cron 表达式非法: {error}")

        existing = await self.task_repo.get_by_title(user_id, title)
        if existing:
            raise ValueError(f"任务 '{title}' 已存在")

        # 1. 派生专属态势洞察助手
        assistant_id = await self._spawn_insight_assistant(user_id, title, objective)

        now = Datetime.now()
        next_run_at = next_run_after(cron_expr, now)
        interval_minutes = max(1, int((next_run_at - now).total_seconds() // 60))
        secure_notify_config = await self._secure_notify_config(notify_config or {})
        normalized_tools = self._normalize_allowed_tools(allowed_tools)

        task = await self.task_repo.create(
            {
                "user_id": user_id,
                "title": title,
                "objective": objective,
                "cron_expr": cron_expr,
                "notify_config": secure_notify_config,
                "allowed_tools": normalized_tools,
                "strategy_variants": strategy_variants or {},
                "status": MonitorStatus.ACTIVE,
                "next_run_at": next_run_at,
                "current_interval_minutes": interval_minutes,
                "assistant_id": assistant_id,
                "model_id": model_id,
            }
        )
        self._schedule_upsert_async(task.id)
        return {
            "id": task.id,
            "title": task.title,
            "status": task.status.value if hasattr(task.status, "value") else str(task.status),
            "message": "任务创建成功并已关联态势助手",
            "assistant_id": assistant_id,
        }

    async def _spawn_insight_assistant(self, user_id: UUID, title: str, objective: str) -> UUID:
        """为监控任务创建专属于该目标的态势分析助手。"""
        from app.services.assistant.assistant_service import AssistantService
        from app.repositories.assistant_repository import AssistantRepository, AssistantVersionRepository
        from app.schemas.assistant import AssistantCreate, AssistantVersionCreate
        from app.models.assistant import AssistantVisibility, AssistantStatus

        # 初始化助手服务 (使用当前的数据库 session)
        assistant_repo = AssistantRepository(self.session)
        version_repo = AssistantVersionRepository(self.session)
        assistant_svc = AssistantService(assistant_repo, version_repo)

        system_prompt = f"""你是一名专门负责【{title}】的态势研判专家。
你的核心目标是：{objective}

你可以访问该监控任务的所有历史快照和执行日志。
当用户向你提问时，请基于最新的监控数据提供深度、专业的分析。
如果用户要求你调整监控策略，请引导用户使用相关的管理工具。
"""

        payload = AssistantCreate(
            name=f"寻猎者: {title}",
            summary=f"针对【{title}】的实时监控与态势研判专属助手。",
            visibility=AssistantVisibility.PRIVATE,
            status=AssistantStatus.PUBLISHED,
            version=AssistantVersionCreate(
                version="1.0.0",
                name="初始寻猎逻辑",
                system_prompt=system_prompt,
                skill_refs=[
                    {"skill_id": "system/monitor"},
                    {"skill_id": "core.tools.crawler"},
                    {"skill_id": "core.tools.search"}
                ]
            )
        )

        assistant = await assistant_svc.create_assistant(payload, owner_user_id=user_id)
        return assistant.id


    async def get_user_tasks(self, user_id: UUID, skip: int = 0, limit: int = 100) -> dict[str, Any]:
        tasks = await self.task_repo.get_by_user(user_id, skip, limit)
        total = await self.task_repo.get_by_user_count(user_id)
        return {
            "items": [self._serialize_task(task) for task in tasks],
            "total": total,
            "skip": skip,
            "limit": limit,
        }

    async def get_task(self, task_id: UUID) -> dict[str, Any] | None:
        task = await self.task_repo.get(task_id)
        if not task:
            return None
        return self._serialize_task(task)

    async def update_task(
        self,
        task_id: UUID,
        user_id: UUID,
        **updates: Any,
    ) -> dict[str, Any]:
        task = await self.task_repo.get(task_id)
        if not task:
            raise ValueError("任务不存在")
        if task.user_id != user_id:
            raise ValueError("无权限操作此任务")

        allowed_fields = {
            "title",
            "objective",
            "cron_expr",
            "status",
            "notify_config",
            "allowed_tools",
        }
        filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}

        if "cron_expr" in filtered_updates:
            ok, error = validate_cron_expr(str(filtered_updates["cron_expr"]))
            if not ok:
                raise ValueError(f"Cron 表达式非法: {error}")

        if "status" in filtered_updates:
            filtered_updates["status"] = MonitorStatus(filtered_updates["status"])
        if "notify_config" in filtered_updates:
            filtered_updates["notify_config"] = await self._secure_notify_config(
                filtered_updates["notify_config"] or {}
            )
        if "allowed_tools" in filtered_updates:
            filtered_updates["allowed_tools"] = self._normalize_allowed_tools(
                filtered_updates["allowed_tools"]
            )

        updated = await self.task_repo.update(task, filtered_updates)
        if self._is_status(updated.status, MonitorStatus.ACTIVE) and updated.is_active:
            self._schedule_upsert_async(updated.id)
        else:
            self._schedule_remove_async(updated.id)
        return {
            "id": updated.id,
            "title": updated.title,
            "status": self._status_value(updated.status),
            "message": "任务更新成功",
        }

    async def pause_task(self, task_id: UUID, user_id: UUID) -> dict[str, Any]:
        task = await self.task_repo.get(task_id)
        if not task:
            raise ValueError("任务不存在")
        if task.user_id != user_id:
            raise ValueError("无权限操作此任务")

        await self.task_repo.update_status(task_id, MonitorStatus.PAUSED)
        self._schedule_remove_async(task_id)
        return {"id": task_id, "status": "paused", "message": "任务已暂停"}

    async def resume_task(self, task_id: UUID, user_id: UUID) -> dict[str, Any]:
        task = await self.task_repo.get(task_id)
        if not task:
            raise ValueError("任务不存在")
        if task.user_id != user_id:
            raise ValueError("无权限操作此任务")

        await self.task_repo.update_status(task_id, MonitorStatus.ACTIVE)
        self._schedule_upsert_async(task_id)
        return {"id": task_id, "status": "active", "message": "任务已恢复"}

    async def delete_task(self, task_id: UUID, user_id: UUID) -> dict[str, Any]:
        task = await self.task_repo.get(task_id)
        if not task:
            raise ValueError("任务不存在")
        if task.user_id != user_id:
            raise ValueError("无权限操作此任务")

        task.is_active = False
        self.session.add(task)
        await self.session.commit()
        self._schedule_remove_async(task_id)

        return {"id": task_id, "message": "任务已删除"}

    async def get_task_stats(self, user_id: UUID) -> dict[str, Any]:
        task_stats = await self.task_repo.get_user_stats(user_id)
        total_executions = await self.log_repo.get_total_count_by_user(user_id)
        return {
            **task_stats,
            "total_executions": total_executions,
        }

    async def get_execution_logs(self, task_id: UUID, skip: int = 0, limit: int = 50) -> dict[str, Any]:
        logs = await self.log_repo.get_by_task(task_id, skip, limit)
        total = await self.log_repo.get_by_task_count(task_id)
        return {
            "items": [self._serialize_execution_log(log) for log in logs],
            "total": total,
            "skip": skip,
            "limit": limit,
        }

    @staticmethod
    def _schedule_upsert_async(task_id: UUID) -> None:
        try:
            from app.tasks.monitor import upsert_monitor_schedule_task

            upsert_monitor_schedule_task.delay(str(task_id))
        except Exception as exc:
            logger.warning(f"monitor_schedule_upsert_dispatch_failed task_id={task_id} err={exc}")

    @staticmethod
    def _schedule_remove_async(task_id: UUID) -> None:
        try:
            from app.tasks.monitor import remove_monitor_schedule_task

            remove_monitor_schedule_task.delay(str(task_id))
        except Exception as exc:
            logger.warning(f"monitor_schedule_remove_dispatch_failed task_id={task_id} err={exc}")

    @staticmethod
    def _status_value(status: MonitorStatus | str) -> str:
        return status.value if isinstance(status, MonitorStatus) else str(status)

    @classmethod
    def _is_status(cls, status: MonitorStatus | str, target: MonitorStatus) -> bool:
        return cls._status_value(status) == target.value

    @staticmethod
    def _is_sensitive_notify_key(key: str) -> bool:
        normalized = (key or "").strip().lower()
        sensitive_keywords = (
            "token",
            "secret",
            "password",
            "webhook",
            "api_key",
            "access_key",
            "private_key",
        )
        return any(keyword in normalized for keyword in sensitive_keywords)

    async def _secure_notify_config(self, config: dict[str, Any]) -> dict[str, Any]:
        secured: dict[str, Any] = {}
        for key, value in (config or {}).items():
            if isinstance(value, dict):
                secured[key] = await self._secure_notify_config(value)
                continue
            if isinstance(value, list):
                secured[key] = [
                    await self._secure_notify_config(item) if isinstance(item, dict) else item
                    for item in value
                ]
                continue
            if (
                isinstance(value, str)
                and value.strip()
                and self._is_sensitive_notify_key(key)
                and not value.startswith("db:")
            ):
                secured[key] = await self.secret_manager.store(
                    provider="monitor_notify",
                    raw_secret=value.strip(),
                    db_session=self.session,
                )
            else:
                secured[key] = value
        return secured

    @classmethod
    def _sanitize_notify_config_for_response(cls, config: dict[str, Any]) -> dict[str, Any]:
        sanitized: dict[str, Any] = {}
        for key, value in (config or {}).items():
            if isinstance(value, dict):
                sanitized[key] = cls._sanitize_notify_config_for_response(value)
                continue
            if isinstance(value, list):
                sanitized[key] = [
                    cls._sanitize_notify_config_for_response(item) if isinstance(item, dict) else item
                    for item in value
                ]
                continue
            if (isinstance(value, str) and value.startswith("db:")) or cls._is_sensitive_notify_key(key):
                sanitized[key] = "***"
            else:
                sanitized[key] = value
        return sanitized

    @classmethod
    def _normalize_allowed_tools(cls, allowed_tools: list[str] | None) -> list[str]:
        if allowed_tools is None:
            return []
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in allowed_tools:
            name = str(raw or "").strip()
            if not name:
                continue
            if not _ALLOWED_TOOL_PATTERN.match(name):
                raise ValueError(f"allowed_tools 含非法工具名: {name}")
            if name in seen:
                continue
            seen.add(name)
            normalized.append(name)
        if len(normalized) > 32:
            raise ValueError("allowed_tools 最多允许 32 个工具")
        return normalized

    def _serialize_task(self, task: Any) -> dict[str, Any]:
        return {
            "id": task.id,
            "user_id": task.user_id,
            "title": task.title,
            "objective": task.objective,
            "cron_expr": task.cron_expr,
            "status": self._status_value(task.status),
            "last_snapshot": task.last_snapshot,
            "last_executed_at": task.last_executed_at,
            "error_count": task.error_count,
            "notify_config": self._sanitize_notify_config_for_response(task.notify_config or {}),
            "allowed_tools": task.allowed_tools,
            "total_tokens": task.total_tokens,
            "current_interval_minutes": task.current_interval_minutes,
            "is_active": task.is_active,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
        }

    @staticmethod
    def _serialize_execution_log(log: Any) -> dict[str, Any]:
        return MonitorExecutionLogResponse.model_validate(log).model_dump()
