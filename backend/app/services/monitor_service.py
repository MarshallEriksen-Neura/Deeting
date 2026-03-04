import re
from datetime import timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.config import settings
from app.core.distributed_lock import distributed_lock
from app.models.monitor import MonitorExecutionLog, MonitorStatus, MonitorTask
from app.repositories.monitor_repository import (
    MonitorExecutionLogRepository,
    MonitorTaskRepository,
)
from app.schemas.monitor import MonitorExecutionLogResponse
from app.services.monitor_dispatch import (
    MonitorExecutionTarget,
    apply_monitor_execution_target,
    desktop_heartbeat_key,
    is_cloud_scheduled_target,
    is_local_dispatch_target,
    normalize_monitor_execution_target,
    resolve_monitor_execution_target,
)
from app.services.monitor_cron import next_run_after, validate_cron_expr
from app.services.secrets.manager import SecretManager
from app.utils.time_utils import Datetime


_ALLOWED_TOOL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$")
_LOCAL_MONITOR_MAX_ERROR_COUNT = 3


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
        execution_target: MonitorExecutionTarget | str = MonitorExecutionTarget.DESKTOP,
        strategy_variants: dict[str, Any] | None = None,
        model_id: str | None = None,
    ) -> dict[str, Any]:
        ok, error = validate_cron_expr(cron_expr)
        if not ok:
            raise ValueError(f"Cron 表达式非法: {error}")
        normalized_target = normalize_monitor_execution_target(execution_target)
        if self._should_enforce_cloud_cron_limit(normalized_target):
            self._validate_cloud_cron_interval(cron_expr)

        existing = await self.task_repo.get_by_title(user_id, title)
        if existing:
            raise ValueError(f"任务 '{title}' 已存在")

        # 1. 派生专属态势洞察助手
        assistant_id = await self._spawn_insight_assistant(user_id, title, objective)

        now = Datetime.now()
        next_run_at = next_run_after(cron_expr, now)
        interval_minutes = max(1, int((next_run_at - now).total_seconds() // 60))
        secure_notify_config = await self._secure_notify_config(notify_config or {})
        secure_notify_config = apply_monitor_execution_target(
            secure_notify_config, normalized_target
        )
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
        if is_cloud_scheduled_target(normalized_target):
            self._schedule_upsert_async(task.id)
        else:
            self._schedule_remove_async(task.id)
        return {
            "id": task.id,
            "title": task.title,
            "status": task.status.value if hasattr(task.status, "value") else str(task.status),
            "message": "任务创建成功并已关联态势助手",
            "assistant_id": assistant_id,
            "execution_target": normalized_target.value,
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
            "execution_target",
        }
        filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}

        if "cron_expr" in filtered_updates:
            ok, error = validate_cron_expr(str(filtered_updates["cron_expr"]))
            if not ok:
                raise ValueError(f"Cron 表达式非法: {error}")

        if "status" in filtered_updates:
            filtered_updates["status"] = MonitorStatus(filtered_updates["status"])
        incoming_notify = filtered_updates.pop("notify_config", None)
        execution_target_update = filtered_updates.pop("execution_target", None)
        merged_notify = (
            await self._secure_notify_config(incoming_notify or {})
            if incoming_notify is not None
            else dict(task.notify_config or {})
        )
        target_from_notify = resolve_monitor_execution_target(merged_notify)
        if execution_target_update is not None:
            resolved_target = normalize_monitor_execution_target(execution_target_update)
        else:
            resolved_target = target_from_notify
        merged_notify = apply_monitor_execution_target(merged_notify, resolved_target)
        filtered_updates["notify_config"] = merged_notify

        if "cron_expr" in filtered_updates and self._should_enforce_cloud_cron_limit(
            resolved_target
        ):
            self._validate_cloud_cron_interval(str(filtered_updates["cron_expr"]))
        if "allowed_tools" in filtered_updates:
            filtered_updates["allowed_tools"] = self._normalize_allowed_tools(
                filtered_updates["allowed_tools"]
            )

        updated = await self.task_repo.update(task, filtered_updates)
        updated_target = resolve_monitor_execution_target(updated.notify_config or {})
        if (
            self._is_status(updated.status, MonitorStatus.ACTIVE)
            and updated.is_active
            and is_cloud_scheduled_target(updated_target)
        ):
            self._schedule_upsert_async(updated.id)
        else:
            self._schedule_remove_async(updated.id)
        return {
            "id": updated.id,
            "title": updated.title,
            "status": self._status_value(updated.status),
            "message": "任务更新成功",
            "execution_target": updated_target.value,
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
        target = resolve_monitor_execution_target(task.notify_config or {})
        if is_cloud_scheduled_target(target):
            self._schedule_upsert_async(task_id)
        else:
            self._schedule_remove_async(task_id)
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

    async def request_local_execution(self, task_id: UUID, user_id: UUID) -> dict[str, Any]:
        task = await self.task_repo.get(task_id)
        if not task:
            raise ValueError("任务不存在")
        if task.user_id != user_id:
            raise ValueError("无权限操作此任务")
        if self._status_value(task.status) != MonitorStatus.ACTIVE.value:
            raise ValueError("仅 active 任务可触发")

        target = resolve_monitor_execution_target(task.notify_config or {})
        if not is_local_dispatch_target(target):
            raise ValueError("任务执行模式为 cloud，请使用云端触发")

        task.next_run_at = Datetime.now()
        self.session.add(task)
        await self.session.commit()
        return {
            "task_id": task.id,
            "execution_target": target.value,
            "message": "已标记为本地立即执行",
        }

    async def record_desktop_heartbeat(self, user_id: UUID, agent_id: str) -> dict[str, Any]:
        now = Datetime.now()
        ttl_seconds = self._desktop_heartbeat_ttl_seconds()
        key = desktop_heartbeat_key(user_id)
        payload = {
            "agent_id": str(agent_id),
            "updated_at": now.isoformat(),
        }
        accepted = await cache.set(key, payload, ex=ttl_seconds)
        return {
            "status": "ok",
            "agent_id": str(agent_id),
            "server_time": now,
            "expires_in_seconds": ttl_seconds,
            "redis_written": bool(accepted),
        }

    async def pull_local_tasks(
        self,
        *,
        user_id: UUID,
        agent_id: str,
        limit: int,
    ) -> dict[str, Any]:
        now = Datetime.now()
        safe_limit = self._normalize_pull_limit(limit)
        lease_seconds = self._local_claim_lease_seconds()
        claimed_until = now + timedelta(seconds=lease_seconds)
        await self.record_desktop_heartbeat(user_id=user_id, agent_id=agent_id)

        items: list[dict[str, Any]] = []
        lock_key = f"monitor:local_pull:{user_id}"
        async with distributed_lock(
            key=lock_key,
            ttl=5,
            retry_times=1,
            retry_delay=0.02,
        ) as acquired:
            if not acquired:
                return {
                    "items": [],
                    "claimed": 0,
                    "server_time": now,
                }

            stmt = (
                select(MonitorTask)
                .where(
                    and_(
                        MonitorTask.user_id == user_id,
                        MonitorTask.status == MonitorStatus.ACTIVE,
                        MonitorTask.is_active == True,
                        MonitorTask.next_run_at.is_not(None),
                        MonitorTask.next_run_at <= now,
                    )
                )
                .order_by(MonitorTask.next_run_at.asc())
                .limit(max(safe_limit * 4, safe_limit))
            )
            tasks = (await self.session.execute(stmt)).scalars().all()
            for task in tasks:
                target = resolve_monitor_execution_target(task.notify_config or {})
                if not is_local_dispatch_target(target):
                    continue

                task.next_run_at = claimed_until
                self.session.add(task)
                items.append(
                    {
                        "task_id": task.id,
                        "title": task.title,
                        "objective": task.objective,
                        "cron_expr": task.cron_expr,
                        "model_id": task.model_id,
                        "allowed_tools": list(task.allowed_tools or []),
                        "last_snapshot": (
                            task.last_snapshot if isinstance(task.last_snapshot, dict) else {}
                        ),
                        "notify_config": self._sanitize_notify_config_for_response(
                            task.notify_config or {}
                        ),
                        "execution_target": target.value,
                        "claimed_until": claimed_until,
                    }
                )
                if len(items) >= safe_limit:
                    break

            if items:
                await self.session.commit()

        return {
            "items": items,
            "claimed": len(items),
            "server_time": now,
        }

    async def report_local_execution(
        self,
        *,
        task_id: UUID,
        user_id: UUID,
        agent_id: str,
        status_value: str,
        is_significant_change: bool = False,
        change_summary: str = "",
        new_snapshot: dict[str, Any] | None = None,
        tokens_used: int = 0,
        error_message: str | None = None,
        force_notify: bool = False,
        model_id: str | None = None,
        strategy: str | None = None,
    ) -> dict[str, Any]:
        task = await self.task_repo.get(task_id)
        if not task:
            raise ValueError("任务不存在")
        if task.user_id != user_id:
            raise ValueError("无权限操作此任务")

        target = resolve_monitor_execution_target(task.notify_config or {})
        if not is_local_dispatch_target(target):
            raise ValueError("任务执行模式为 cloud，禁止本地回传")

        normalized_status = str(status_value or "").strip().lower()
        if normalized_status not in {"success", "failure", "skipped"}:
            raise ValueError("status 仅支持 success/failure/skipped")

        now = Datetime.now()
        snapshot = new_snapshot if isinstance(new_snapshot, dict) else {}
        summary = str(change_summary or "").strip()
        token_cost = max(0, int(tokens_used or 0))
        log_error = (
            str(error_message or "").strip()[:2000] if normalized_status != "success" else None
        )

        log = MonitorExecutionLog(
            task_id=task.id,
            triggered_at=now,
            status=normalized_status,
            input_data={
                "source": "desktop",
                "agent_id": str(agent_id),
                "model": model_id,
                "strategy": strategy,
            },
            output_data={
                "analysis": {
                    "is_significant_change": bool(is_significant_change),
                    "change_summary": summary,
                    "new_snapshot": snapshot,
                }
            },
            tokens_used=token_cost,
            error_message=log_error,
        )
        self.session.add(log)

        suspend_reason: str | None = None
        if normalized_status == "success":
            if snapshot:
                task.last_snapshot = snapshot
            task.total_tokens += token_cost
            task.error_count = 0
            next_run_at, interval_minutes = self._compute_next_run(task, now)
            task.current_interval_minutes = interval_minutes
            task.next_run_at = next_run_at
            task.last_executed_at = now

            if bool(is_significant_change) or bool(force_notify):
                summary_text = summary
                if not summary_text:
                    summary_text = "### 例行简报\n桌面端执行完成，当前未提供变化摘要。"
                self._enqueue_monitor_notification(task.id, summary_text, snapshot)
        elif normalized_status == "failure":
            task.error_count += 1
            task.last_executed_at = now
            task.next_run_at = now + timedelta(seconds=self._local_failure_retry_seconds())
            if (
                task.error_count > _LOCAL_MONITOR_MAX_ERROR_COUNT
                and self._status_value(task.status) != MonitorStatus.FAILED_SUSPENDED.value
            ):
                task.status = MonitorStatus.FAILED_SUSPENDED
                suspend_reason = "本地执行连续失败，任务已自动熔断挂起。"
        else:
            task.last_executed_at = now
            task.next_run_at = now + timedelta(seconds=self._local_failure_retry_seconds())

        self.session.add(task)
        await self.session.commit()

        if is_cloud_scheduled_target(target):
            self._schedule_upsert_async(task.id)
        else:
            self._schedule_remove_async(task.id)

        if suspend_reason:
            self._enqueue_task_suspended_notification(task, suspend_reason)

        return {
            "task_id": task.id,
            "status": normalized_status,
            "execution_target": target.value,
            "next_run_at": task.next_run_at,
            "message": "本地执行结果已接收",
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
    def _desktop_heartbeat_ttl_seconds() -> int:
        return max(30, int(settings.MONITOR_DESKTOP_HEARTBEAT_TTL_SECONDS or 120))

    @staticmethod
    def _local_claim_lease_seconds() -> int:
        return max(30, int(settings.MONITOR_LOCAL_CLAIM_LEASE_SECONDS or 180))

    @staticmethod
    def _normalize_pull_limit(limit: int) -> int:
        max_limit = max(1, int(settings.MONITOR_DESKTOP_PULL_MAX_LIMIT or 20))
        safe_limit = max(1, int(limit or 1))
        return min(safe_limit, max_limit)

    @staticmethod
    def _local_failure_retry_seconds() -> int:
        return max(30, int(settings.MONITOR_BACKPRESSURE_DELAY_SECONDS or 60))

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

    @staticmethod
    def _estimate_cron_interval_minutes(cron_expr: str) -> int:
        """
        估算 Cron 的执行间隔（分钟）。
        采用连续两次 next_run 差值，避免受“当前时刻对齐边界”影响。
        """
        now = Datetime.now()
        first = next_run_after(cron_expr, now)
        second = next_run_after(cron_expr, first)
        interval_seconds = int((second - first).total_seconds())
        return max(1, interval_seconds // 60)

    @classmethod
    def _validate_cloud_cron_interval(cls, cron_expr: str) -> None:
        min_minutes = max(1, int(settings.MONITOR_MIN_CLOUD_INTERVAL_MINUTES or 1))
        interval_minutes = cls._estimate_cron_interval_minutes(cron_expr)
        if interval_minutes < min_minutes:
            raise ValueError(
                f"Cron 频率过高：当前约每 {interval_minutes} 分钟执行一次，"
                f"云端最小允许间隔为 {min_minutes} 分钟"
            )

    @staticmethod
    def _should_enforce_cloud_cron_limit(target: MonitorExecutionTarget | str) -> bool:
        return normalize_monitor_execution_target(target) == MonitorExecutionTarget.CLOUD

    @staticmethod
    def _compute_next_run(task: MonitorTask, from_time) -> tuple[Any, int]:
        cron_expr = (task.cron_expr or "").strip()
        if cron_expr:
            try:
                next_run = next_run_after(cron_expr, from_time)
                interval = max(1, int((next_run - from_time).total_seconds() // 60))
                return next_run, interval
            except Exception:
                pass
        interval = max(1, int(task.current_interval_minutes or 360))
        return from_time + timedelta(minutes=interval), interval

    @staticmethod
    def _enqueue_monitor_notification(
        task_id: UUID,
        change_summary: str,
        snapshot: dict[str, Any] | None,
    ) -> None:
        try:
            from app.tasks.monitor import NOTIFICATION_QUEUE, notification_task

            notification_task.apply_async(
                args=[str(task_id), change_summary, snapshot or {}],
                queue=NOTIFICATION_QUEUE,
            )
        except Exception as exc:
            logger.warning("monitor_local_notify_enqueue_failed task_id={} err={}", task_id, exc)

    @staticmethod
    def _enqueue_task_suspended_notification(task: MonitorTask, reason: str) -> None:
        try:
            from app.tasks.monitor import NOTIFICATION_QUEUE, notification_task

            notification_task.apply_async(
                args=[
                    str(task.id),
                    (
                        "⚠️ 监控任务已熔断挂起\n\n"
                        f"- 任务: {task.title}\n"
                        f"- 原因: {reason}\n"
                        f"- 连续失败次数: {task.error_count}\n\n"
                        "请检查任务目标、工具配置或恢复后重试。"
                    ),
                    {"system_alert": True, "status": "failed_suspended", "reason": reason},
                ],
                queue=NOTIFICATION_QUEUE,
            )
        except Exception as exc:
            logger.warning(
                "monitor_local_suspended_notify_enqueue_failed task_id={} err={}",
                task.id,
                exc,
            )

    def _serialize_task(self, task: Any) -> dict[str, Any]:
        target = resolve_monitor_execution_target(task.notify_config or {})
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
            "execution_target": target.value,
            "total_tokens": task.total_tokens,
            "current_interval_minutes": task.current_interval_minutes,
            "is_active": task.is_active,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
        }

    @staticmethod
    def _serialize_execution_log(log: Any) -> dict[str, Any]:
        return MonitorExecutionLogResponse.model_validate(log).model_dump()
