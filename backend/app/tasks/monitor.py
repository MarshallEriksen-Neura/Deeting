from __future__ import annotations

import json
import random
import uuid
from datetime import timedelta
from typing import Any

from loguru import logger
from sqlalchemy import and_, or_, select

from app.core.cache import cache
from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.distributed_lock import distributed_lock
from app.models.monitor import (
    MonitorDeadLetter,
    MonitorExecutionLog,
    MonitorStatus,
    MonitorTask,
)
from app.services.monitor_cron import next_run_after
from app.services.orchestrator.config import INTERNAL_CHAT_WORKFLOW, WorkflowConfig, WorkflowTemplate
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import GatewayOrchestrator
from app.tasks.async_runner import run_async
from app.schemas.gateway import ChatCompletionRequest
from app.utils.time_utils import Datetime

REASONING_QUEUE = "reasoning"
NOTIFICATION_QUEUE = "notification"
DEAD_LETTER_QUEUE = "monitor_dlq"
MAX_ERROR_COUNT = 3
RETRY_MAX = 3
JITTER_MAX_SECONDS = 120
SCHEDULER_BATCH_SIZE = 200
SCHEDULE_ZSET_KEY = "monitor:schedule:zset"
MONITOR_MAX_RAW_OUTPUT_CHARS = 40_000
MONITOR_MAX_CHANGE_SUMMARY_CHARS = 4_000
MONITOR_MAX_SNAPSHOT_BYTES = 16_000
MONITOR_MIN_SUMMARY_CHARS_FOR_NO_SNAPSHOT = 120

# 监控任务专用工作流：走真实 orchestrator，不做测试上游注入。
MONITOR_WORKFLOW = WorkflowConfig(
    template=WorkflowTemplate.INTERNAL_CHAT,
    steps=[
        "validation",
        "resolve_assets",
        "mcp_discovery",
        "quota_check",
        "rate_limit",
        "routing",
        "template_render",
        "agent_executor",
        "response_transform",
        "billing",
        "audit_log",
    ],
    step_configs=dict(INTERNAL_CHAT_WORKFLOW.step_configs),
)


def _status_value(status: MonitorStatus | str) -> str:
    return status.value if isinstance(status, MonitorStatus) else str(status)


def _redis_schedule_key() -> str:
    return f"{settings.CACHE_PREFIX}{SCHEDULE_ZSET_KEY}"


def _get_redis_client():
    try:
        return cache.redis
    except Exception:
        return None


def _decode_member(member: Any) -> str:
    if isinstance(member, bytes):
        return member.decode("utf-8", errors="ignore")
    return str(member)


async def _zset_add_task(task_id: str, run_at) -> None:
    redis = _get_redis_client()
    if redis is None:
        return
    await redis.zadd(_redis_schedule_key(), {task_id: run_at.timestamp()})


async def _zset_remove_task(task_id: str) -> None:
    redis = _get_redis_client()
    if redis is None:
        return
    await redis.zrem(_redis_schedule_key(), task_id)


async def _zset_pop_due_task_ids(now_ts: float, limit: int = SCHEDULER_BATCH_SIZE) -> list[str]:
    redis = _get_redis_client()
    if redis is None:
        return []
    script = """
    local key = KEYS[1]
    local now_ts = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local members = redis.call('ZRANGEBYSCORE', key, '-inf', now_ts, 'LIMIT', 0, limit)
    if #members > 0 then
        redis.call('ZREM', key, unpack(members))
    end
    return members
    """
    try:
        raw = await redis.eval(script, 1, _redis_schedule_key(), now_ts, limit)
    except Exception as exc:
        logger.warning("monitor_scheduler_atomic_pop_failed err={} fallback=non_atomic", exc)
        raw = await redis.zrangebyscore(
            _redis_schedule_key(), min="-inf", max=now_ts, start=0, num=limit
        )
        if raw:
            await redis.zrem(_redis_schedule_key(), *[_decode_member(item) for item in raw])

    if not raw:
        return []
    return [_decode_member(item) for item in raw]


def _compute_next_run(task: MonitorTask, from_time) -> tuple[Any, int]:
    """
    统一计算下一次执行时间：
    - 优先按任务 cron_expr
    - 若 cron 解析失败，降级为 current_interval_minutes
    """
    cron_expr = (task.cron_expr or "").strip()
    if cron_expr:
        try:
            next_run = next_run_after(cron_expr, from_time)
            interval = max(1, int((next_run - from_time).total_seconds() // 60))
            return next_run, interval
        except Exception as exc:
            logger.warning(
                "monitor_next_run_by_cron_failed task_id={} cron={} err={}",
                task.id,
                cron_expr,
                exc,
            )

    interval = max(1, int(task.current_interval_minutes or 360))
    return from_time + timedelta(minutes=interval), interval


def _is_final_retry(task_ctx, max_retries: int = RETRY_MAX) -> bool:
    try:
        retries = int(getattr(task_ctx.request, "retries", 0) or 0)
    except Exception:
        retries = 0
    return retries >= max_retries


def _enqueue_dead_letter(
    *,
    worker: str,
    task_id: str | None,
    payload: dict[str, Any] | None,
    error_message: str,
    retry_count: int,
) -> None:
    try:
        dead_letter_task.delay(
            worker=worker,
            task_id=task_id,
            payload=payload or {},
            error_message=error_message[:2000],
            retry_count=retry_count,
        )
    except Exception as exc:
        logger.warning("monitor_dead_letter_enqueue_failed worker={} err={}", worker, exc)


@celery_app.task(bind=True, name="app.tasks.monitor.trigger_reasoning", queue="default")
def trigger_reasoning_task(self, task_id: str, force_notify: bool = False) -> dict[str, Any]:
    # 手动触发（force_notify）要求尽快执行并强制推送，避免 ETA 调度带来的延迟/丢失风险。
    jitter = 0 if bool(force_notify) else random.randint(0, JITTER_MAX_SECONDS)
    reasoning_task.apply_async(
        args=[task_id, bool(force_notify)],
        countdown=jitter,
        queue=REASONING_QUEUE,
    )
    return {"status": "triggered", "task_id": task_id, "jitter": jitter, "force_notify": bool(force_notify)}


@celery_app.task(
    bind=True,
    name="app.tasks.monitor.reasoning_worker",
    queue=REASONING_QUEUE,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=RETRY_MAX,
)
def reasoning_task(self, task_id: str, force_notify: bool = False) -> dict[str, Any]:
    logger.info(f"monitor_reasoning_started task_id={task_id} force_notify={bool(force_notify)}")
    try:
        return run_async(_execute_reasoning_flow(task_id, bool(force_notify)))
    except Exception as exc:
        if _is_final_retry(self):
            retries = int(getattr(self.request, "retries", RETRY_MAX) or RETRY_MAX)
            _enqueue_dead_letter(
                worker="reasoning_worker",
                task_id=task_id,
                payload={"task_id": task_id},
                error_message=str(exc),
                retry_count=retries,
            )
        raise


async def _resolve_task_model(session, task: MonitorTask) -> str:
    """
    研判模型选择优先级：
    1) 任务绑定模型（创建任务时记录）
    2) 用户秘书默认模型
    3) 系统默认内部模型
    """
    if task.model_id and str(task.model_id).strip():
        return str(task.model_id).strip()

    from app.repositories.secretary_repository import UserSecretaryRepository

    secretary_repo = UserSecretaryRepository(session)
    secretary = await secretary_repo.get_by_user_id(task.user_id)
    if secretary and secretary.model_name and secretary.model_name.strip():
        return secretary.model_name.strip()

    from app.repositories.system_setting_repository import SystemSettingRepository

    setting_repo = SystemSettingRepository(session)
    default_model_setting = await setting_repo.get_by_key("default_internal_model")
    if default_model_setting:
        value = default_model_setting.value
        if isinstance(value, dict):
            model_id = value.get("model_id")
            if isinstance(model_id, str) and model_id.strip():
                return model_id.strip()
        if isinstance(value, str) and value.strip():
            return value.strip()

    raise RuntimeError(f"Monitor task {task.id} 无可用模型（task/user/system 均未配置）")


async def _execute_reasoning_flow(task_id: str, force_notify: bool = False) -> dict[str, Any]:
    async with AsyncSessionLocal() as session:
        task = await session.get(MonitorTask, uuid.UUID(task_id))
        if not task or not task.is_active:
            return {"status": "skipped", "reason": "task_not_found_or_inactive"}
        if _status_value(task.status) != MonitorStatus.ACTIVE.value:
            return {"status": "skipped", "reason": "task_not_active"}

        triggered_at = Datetime.now()
        selected_strategy = "默认精简研判策略"
        strategy_scene = f"ms:{task.id}"
        target_model = await _resolve_task_model(session, task)

        from app.repositories.bandit_repository import BanditRepository
        from app.services.decision.decision_service import DecisionCandidate, DecisionService

        decision_svc = DecisionService(BanditRepository(session))
        variants = (
            task.strategy_variants.get("prompts", [selected_strategy])
            if task.strategy_variants
            else [selected_strategy]
        )
        notify_suspended_reason: str | None = None
        try:
            ranked = await decision_svc.rank_candidates(
                scene=strategy_scene,
                candidates=[DecisionCandidate(arm_id=p, base_score=1.0) for p in variants],
            )
            selected_strategy = ranked[0].arm_id
        except Exception as exc:
            logger.warning(f"monitor_strategy_rank_failed task_id={task_id} err={exc}")

        try:
            ctx = WorkflowContext(
                channel=Channel.INTERNAL,
                user_id=str(task.user_id),
                tenant_id=str(task.user_id),
                # 定时任务不是外部 API Key 调用，这里不绑定真实 API Key。
                api_key_id=None,
                session_id=f"monitor:{task.id}",
                capability="chat",
                requested_model=target_model,
                db_session=session,
                trace_id=f"monitor_{task_id}_{triggered_at.strftime('%Y%m%d%H%M%S')}",
            )

            from app.models.user import User

            user_obj = await session.get(User, task.user_id)
            ctx.set("auth", "user", user_obj)
            ctx.set("auth", "tenant_id", str(task.user_id))
            ctx.set("monitor", "allowed_tools", task.allowed_tools or [])

            prompt = _build_monitor_prompt(task, selected_strategy)
            req = ChatCompletionRequest(
                model=target_model,
                messages=[{"role": "user", "content": prompt}],
                stream=False,
                session_id=f"monitor:{task.id}",
            )
            ctx.set("validation", "request", req)
            ctx.set("validation", "validated", req.model_dump())

            orchestrator = GatewayOrchestrator(workflow_config=MONITOR_WORKFLOW)
            await orchestrator.execute(ctx)

            output_content = ""
            final_resp = ctx.get("response_transform", "response") or ctx.get("upstream_call", "response")
            if isinstance(final_resp, dict):
                choices = final_resp.get("choices") or []
                if choices:
                    output_content = choices[0].get("message", {}).get("content", "") or ""

            analysis = _parse_agent_output(output_content)
            has_change = bool(analysis.get("is_significant_change", False))

            log = MonitorExecutionLog(
                task_id=task.id,
                triggered_at=triggered_at,
                status="success" if ctx.is_success else "failure",
                input_data={
                    "strategy": selected_strategy,
                    "model": target_model,
                    "last_snapshot": task.last_snapshot,
                },
                output_data={"analysis": analysis},
                tokens_used=ctx.billing.total_tokens,
                error_message=ctx.error_message if not ctx.is_success else None,
            )
            session.add(log)

            if ctx.is_success:
                task.last_snapshot = analysis.get("new_snapshot") or task.last_snapshot
                task.total_tokens += ctx.billing.total_tokens
                task.error_count = 0
                await _record_mab_feedback(
                    decision_svc,
                    strategy_scene,
                    selected_strategy,
                    1.0 if has_change else 0.1,
                )
                next_run_at, interval_minutes = _compute_next_run(task, Datetime.now())
                task.current_interval_minutes = interval_minutes
                task.next_run_at = next_run_at
                task.last_executed_at = triggered_at
                should_notify = has_change or bool(force_notify)
                if should_notify:
                    change_summary = str(analysis.get("change_summary") or "").strip()
                    if (not has_change) and bool(force_notify) and not str(change_summary or "").strip():
                        change_summary = (
                            "### 例行简报\n"
                            "手动触发：本次未检测到显著变化，按要求推送最新研判结果。"
                        )
                    notification_task.apply_async(
                        args=[
                            task_id,
                            change_summary,
                            analysis.get("new_snapshot"),
                        ],
                        queue=NOTIFICATION_QUEUE,
                    )
            else:
                task.error_count += 1
                task.last_executed_at = triggered_at
                if (
                    task.error_count > MAX_ERROR_COUNT
                    and _status_value(task.status) != MonitorStatus.FAILED_SUSPENDED.value
                ):
                    task.status = MonitorStatus.FAILED_SUSPENDED
                    notify_suspended_reason = "研判连续失败，任务已自动熔断挂起。"

            await session.commit()
            if notify_suspended_reason:
                _notify_task_suspended(task, notify_suspended_reason)
            return {
                "status": "success",
                "model": target_model,
                "strategy": selected_strategy,
            }
        except Exception as exc:
            logger.exception(f"monitor_reasoning_failed task_id={task_id} err={exc}")
            task.error_count += 1
            task.last_executed_at = triggered_at
            notify_suspended = False
            if (
                task.error_count > MAX_ERROR_COUNT
                and _status_value(task.status) != MonitorStatus.FAILED_SUSPENDED.value
            ):
                task.status = MonitorStatus.FAILED_SUSPENDED
                notify_suspended = True
            log = MonitorExecutionLog(
                task_id=task.id,
                triggered_at=triggered_at,
                status="failure",
                input_data={"strategy": selected_strategy, "model": target_model},
                error_message=str(exc),
            )
            session.add(log)
            await session.commit()
            if notify_suspended:
                _notify_task_suspended(task, "研判阶段异常过多，任务已自动熔断挂起。")
            raise


def _build_monitor_prompt(task: MonitorTask, strategy: str) -> str:
    snapshot = json.dumps(task.last_snapshot, ensure_ascii=False) if task.last_snapshot else "无"
    return f"""你现在担任高级情报研判官。任务：{task.title}
目标：{task.objective}
策略焦点：{strategy}
历史快照：{snapshot}

请获取最新信息，必须以 JSON 格式输出：
{{
  "is_significant_change": boolean,
  "change_summary": "用于通知的可读 Markdown 简报（即使无显著变化，也要给出简报）",
  "new_snapshot": {{ ... }}
}}
"""


def _snapshot_size_bytes(data: dict[str, Any]) -> int:
    try:
        return len(json.dumps(data, ensure_ascii=False).encode("utf-8"))
    except Exception:
        return 0


def _clamp_snapshot(snapshot: Any) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {}

    if _snapshot_size_bytes(snapshot) <= MONITOR_MAX_SNAPSHOT_BYTES:
        return snapshot

    key_metrics = snapshot.get("key_metrics")
    if isinstance(key_metrics, dict):
        compact = {"key_metrics": key_metrics}
        if _snapshot_size_bytes(compact) <= MONITOR_MAX_SNAPSHOT_BYTES:
            return compact

    preview = json.dumps(snapshot, ensure_ascii=False)[:1000]
    return {"truncated": True, "preview": preview}


def _parse_agent_output(content: str) -> dict[str, Any]:
    content = (content or "").strip()
    if not content:
        return {
            "is_significant_change": False,
            "change_summary": "",
            "new_snapshot": {},
        }
    if len(content) > MONITOR_MAX_RAW_OUTPUT_CHARS:
        content = content[:MONITOR_MAX_RAW_OUTPUT_CHARS]

    try:
        start, end = content.find("{"), content.rfind("}") + 1
        if start != -1 and end > 0:
            parsed = json.loads(content[start:end])
            if not isinstance(parsed, dict):
                raise ValueError("analysis_not_dict")

            is_change = bool(parsed.get("is_significant_change", False))
            summary_raw = parsed.get("change_summary")
            summary = summary_raw if isinstance(summary_raw, str) else ""
            if len(summary) > MONITOR_MAX_CHANGE_SUMMARY_CHARS:
                summary = summary[:MONITOR_MAX_CHANGE_SUMMARY_CHARS]
            snapshot = _clamp_snapshot(parsed.get("new_snapshot"))
            if not summary.strip():
                summary = _build_snapshot_summary(snapshot, is_significant_change=is_change)
            return {
                "is_significant_change": is_change,
                "change_summary": summary,
                "new_snapshot": snapshot,
            }
    except Exception:
        pass
    return {
        "is_significant_change": False,
        "change_summary": "",
        "new_snapshot": {},
    }


def _build_snapshot_summary(snapshot: dict[str, Any], *, is_significant_change: bool) -> str:
    if not isinstance(snapshot, dict) or not snapshot:
        return ""

    lines: list[str] = []
    if is_significant_change:
        lines.append("### 研判结论")
        lines.append("检测到显著变化，请关注下列关键信号。")
    else:
        lines.append("### 例行简报")
        lines.append("当前未检测到显著变化，以下为最新态势更新。")

    status = snapshot.get("status")
    if isinstance(status, str) and status.strip():
        lines.append("")
        lines.append(f"- 当前状态: `{status.strip()}`")

    timestamp = snapshot.get("timestamp_utc") or snapshot.get("updated_at") or snapshot.get("time")
    if isinstance(timestamp, str) and timestamp.strip():
        lines.append(f"- 更新时间: {timestamp.strip()}")

    key_facts = snapshot.get("key_facts")
    if isinstance(key_facts, list):
        facts = [str(item).strip() for item in key_facts if str(item).strip()]
        if facts:
            lines.append("")
            lines.append("### 关键事实")
            for fact in facts[:5]:
                lines.append(f"- {fact}")

    scenarios = snapshot.get("scenarios")
    if isinstance(scenarios, dict) and scenarios:
        pairs = []
        for name, score in scenarios.items():
            name_text = str(name).strip()
            score_text = str(score).strip()
            if not name_text or not score_text:
                continue
            pairs.append((name_text, score_text))
        if pairs:
            lines.append("")
            lines.append("### 场景评估")
            for name_text, score_text in pairs[:5]:
                lines.append(f"- {name_text}: {score_text}")

    summary = "\n".join(lines).strip()
    if len(summary) > MONITOR_MAX_CHANGE_SUMMARY_CHARS:
        return summary[:MONITOR_MAX_CHANGE_SUMMARY_CHARS]
    return summary


async def _record_mab_feedback(svc, scene, arm, reward):
    try:
        await svc.record_feedback(scene=scene, arm_id=arm, reward=reward, success=True)
    except Exception:
        pass


def _notify_task_suspended(task: MonitorTask, reason: str) -> None:
    try:
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
        logger.warning("monitor_suspended_notify_enqueue_failed task_id={} err={}", task.id, exc)


@celery_app.task(bind=True, name="app.tasks.monitor.dead_letter", queue=DEAD_LETTER_QUEUE)
def dead_letter_task(
    self,
    worker: str,
    task_id: str | None,
    payload: dict[str, Any] | None,
    error_message: str,
    retry_count: int,
) -> dict[str, Any]:
    return run_async(
        _persist_dead_letter(
            worker=worker,
            task_id=task_id,
            payload=payload,
            error_message=error_message,
            retry_count=retry_count,
        )
    )


async def _persist_dead_letter(
    *,
    worker: str,
    task_id: str | None,
    payload: dict[str, Any] | None,
    error_message: str,
    retry_count: int,
) -> dict[str, Any]:
    async with AsyncSessionLocal() as session:
        task_uuid: uuid.UUID | None = None
        task: MonitorTask | None = None
        if task_id:
            try:
                task_uuid = uuid.UUID(task_id)
                task = await session.get(MonitorTask, task_uuid)
            except Exception:
                task_uuid = None

        dlq_record = MonitorDeadLetter(
            task_id=task_uuid if task else None,
            worker=worker,
            retry_count=max(0, int(retry_count)),
            payload=payload or {},
            error_message=error_message[:2000] if error_message else "unknown_error",
        )
        session.add(dlq_record)
        await session.commit()

        if task:
            try:
                from app.services.notifications.user_notification_service import UserNotificationService

                service = UserNotificationService(session)
                await service.notify_user(
                    user_id=task.user_id,
                    title=f"🚨 监控任务进入死信队列: {task.title}",
                    content=(
                        "任务在多次重试后仍失败，已进入死信队列。\n\n"
                        f"- Worker: {worker}\n"
                        f"- Retry Count: {retry_count}\n"
                        f"- Error: {error_message[:500]}"
                    ),
                    extra={
                        "monitor_task_id": str(task.id),
                        "dlq_id": str(dlq_record.id),
                        "worker": worker,
                    },
                )
            except Exception as exc:
                logger.warning("monitor_dlq_system_notify_failed task_id={} err={}", task.id, exc)

        return {"status": "recorded", "dlq_id": str(dlq_record.id)}


@celery_app.task(
    bind=True,
    name="app.tasks.monitor.notification_worker",
    queue=NOTIFICATION_QUEUE,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=RETRY_MAX,
)
def notification_task(self, task_id: str, change_summary: str | None, new_snapshot: dict | None) -> dict[str, Any]:
    try:
        return run_async(_execute_notification_flow(task_id, change_summary, new_snapshot))
    except Exception as exc:
        if _is_final_retry(self):
            retries = int(getattr(self.request, "retries", RETRY_MAX) or RETRY_MAX)
            _enqueue_dead_letter(
                worker="notification_worker",
                task_id=task_id,
                payload={
                    "task_id": task_id,
                    "change_summary": (change_summary or "")[:1000],
                    "snapshot_keys": sorted(list((new_snapshot or {}).keys()))[:20],
                },
                error_message=str(exc),
                retry_count=retries,
            )
        raise


@celery_app.task(
    bind=True,
    name="app.tasks.monitor.feishu_message_reply",
    queue="default",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=2,
)
def feishu_message_reply_task(self, payload: dict[str, Any]) -> dict[str, Any]:
    return run_async(_execute_feishu_message_reply(payload))


async def _execute_feishu_message_reply(payload: dict[str, Any]) -> dict[str, Any]:
    from app.services.monitoring.feishu_bot_service import FeishuBotService

    service = FeishuBotService()
    return await service.process_message_event(payload if isinstance(payload, dict) else {})


def _extract_notify_channel_ids(notify_config: dict[str, Any] | None) -> list[uuid.UUID]:
    raw_ids = (notify_config or {}).get("channel_ids")
    if not isinstance(raw_ids, list):
        return []

    parsed: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for raw in raw_ids:
        try:
            channel_id = uuid.UUID(str(raw))
        except Exception:
            continue
        if channel_id in seen:
            continue
        seen.add(channel_id)
        parsed.append(channel_id)
    return parsed


async def _execute_notification_flow(task_id: str, summary: str | None, snapshot: dict | None) -> dict[str, Any]:
    from app.services.notifications.user_notification_service import UserNotificationService

    async with AsyncSessionLocal() as session:
        task = await session.get(MonitorTask, uuid.UUID(task_id))
        if not task:
            return {"status": "error", "reason": "task_not_found"}
        service = UserNotificationService(session)
        channel_ids = _extract_notify_channel_ids(task.notify_config if isinstance(task.notify_config, dict) else None)
        summary_text = str(summary or "").strip()
        extra = {
            "monitor_task_id": str(task.id),
            "trace_id": f"notif_{task_id}_{Datetime.now().strftime('%y%m%d%H%M')}",
        }
        if task.assistant_id:
            extra["assistant_id"] = str(task.assistant_id)
        # 正文足够时优先展示正文，避免卡片被快照 JSON 淹没。
        if snapshot and len(summary_text) < MONITOR_MIN_SUMMARY_CHARS_FOR_NO_SNAPSHOT:
            extra["snapshot_preview"] = snapshot
        results = await service.notify_user(
            user_id=task.user_id,
            title=f"🔔 监控提醒: {task.title}",
            content=summary_text or "变化提醒",
            extra=extra,
            channel_ids=channel_ids or None,
            stop_on_success=not bool(channel_ids),
        )
        return {"status": "success", "count": len(results)}


@celery_app.task(bind=True, name="app.tasks.monitor.scheduler", queue="default")
def scheduler_task(self) -> dict[str, Any]:
    return run_async(_scan_and_trigger_tasks())


async def _scan_and_trigger_tasks() -> dict[str, Any]:
    now = Datetime.now()
    async with AsyncSessionLocal() as session:
        redis = _get_redis_client()
        if redis is not None:
            try:
                due_task_ids = await _zset_pop_due_task_ids(now.timestamp(), SCHEDULER_BATCH_SIZE)
                if due_task_ids:
                    parsed_ids: list[uuid.UUID] = []
                    for task_id in due_task_ids:
                        try:
                            parsed_ids.append(uuid.UUID(task_id))
                        except Exception:
                            logger.warning("monitor_scheduler_invalid_task_id task_id={}", task_id)

                    if parsed_ids:
                        stmt = select(MonitorTask).where(MonitorTask.id.in_(parsed_ids))
                        tasks = (await session.execute(stmt)).scalars().all()
                        task_map = {str(task.id): task for task in tasks}
                        triggered = 0

                        for task_id in due_task_ids:
                            task = task_map.get(task_id)
                            if not task:
                                continue
                            if not task.is_active or _status_value(task.status) != MonitorStatus.ACTIVE.value:
                                continue

                            trigger_reasoning_task.delay(task_id)
                            next_run_at, interval_minutes = _compute_next_run(task, now)
                            task.current_interval_minutes = interval_minutes
                            task.next_run_at = next_run_at
                            await _zset_add_task(task_id, next_run_at)
                            triggered += 1

                        await session.commit()
                        return {"status": "success", "triggered": triggered, "source": "redis_zset"}

                return {"status": "success", "triggered": 0, "source": "redis_zset"}
            except Exception as exc:
                logger.warning("monitor_scheduler_redis_failed err={} fallback=db_scan", exc)

        # Redis 不可用时降级：扫描 DB 到期任务，保障可用性。
        stmt = select(MonitorTask).where(
            and_(
                MonitorTask.status == MonitorStatus.ACTIVE,
                MonitorTask.is_active == True,
                or_(MonitorTask.next_run_at == None, MonitorTask.next_run_at <= now),
            )
        )
        tasks = (await session.execute(stmt)).scalars().all()
        for task in tasks:
            trigger_reasoning_task.delay(str(task.id))
            next_run_at, interval_minutes = _compute_next_run(task, now)
            task.current_interval_minutes = interval_minutes
            task.next_run_at = next_run_at
        await session.commit()
        return {"status": "success", "triggered": len(tasks), "source": "db_fallback"}


@celery_app.task(bind=True, name="app.tasks.monitor.bootstrap_schedule", queue="default")
def bootstrap_schedule_task(self) -> dict[str, Any]:
    return run_async(_bootstrap_schedule())


async def _bootstrap_schedule() -> dict[str, Any]:
    """
    冷启动/周期自愈：
    - 扫描 active 任务并确保 next_run_at 可用
    - 重建 Redis ZSET 调度索引
    """
    now = Datetime.now()
    loaded = 0
    async with distributed_lock(
        key="monitor:schedule:bootstrap",
        ttl=120,
        retry_times=1,
        retry_delay=0.05,
    ) as acquired:
        if not acquired:
            return {"status": "skipped", "reason": "bootstrap_lock_not_acquired"}

        async with AsyncSessionLocal() as session:
            stmt = select(MonitorTask).where(
                and_(
                    MonitorTask.status == MonitorStatus.ACTIVE,
                    MonitorTask.is_active == True,
                )
            )
            tasks = (await session.execute(stmt)).scalars().all()
            for task in tasks:
                if task.next_run_at is None:
                    next_run_at, interval_minutes = _compute_next_run(task, now)
                    task.current_interval_minutes = interval_minutes
                    task.next_run_at = next_run_at
                try:
                    await _zset_add_task(str(task.id), task.next_run_at)
                    loaded += 1
                except Exception as exc:
                    logger.warning("monitor_bootstrap_zset_add_failed task_id={} err={}", task.id, exc)
            await session.commit()
    return {"status": "success", "loaded": loaded}


@celery_app.task(bind=True, name="app.tasks.monitor.upsert_schedule", queue="default")
def upsert_monitor_schedule_task(self, task_id: str) -> dict[str, Any]:
    return run_async(_upsert_schedule(task_id))


async def _upsert_schedule(task_id: str) -> dict[str, Any]:
    async with AsyncSessionLocal() as session:
        task = await session.get(MonitorTask, uuid.UUID(task_id))
        if not task:
            return {"status": "skipped", "reason": "task_not_found"}
        if not task.is_active or _status_value(task.status) != MonitorStatus.ACTIVE.value:
            task.next_run_at = None
            try:
                await _zset_remove_task(task_id)
            except Exception as exc:
                logger.warning("monitor_schedule_zset_remove_failed task_id={} err={}", task_id, exc)
        else:
            next_run_at, interval_minutes = _compute_next_run(task, Datetime.now())
            task.current_interval_minutes = interval_minutes
            task.next_run_at = next_run_at
            try:
                await _zset_add_task(task_id, next_run_at)
            except Exception as exc:
                logger.warning("monitor_schedule_zset_add_failed task_id={} err={}", task_id, exc)
        await session.commit()
        return {"status": "upserted", "task_id": task_id}


@celery_app.task(bind=True, name="app.tasks.monitor.remove_schedule", queue="default")
def remove_monitor_schedule_task(self, task_id: str) -> dict[str, Any]:
    return run_async(_remove_schedule(task_id))


async def _remove_schedule(task_id: str) -> dict[str, Any]:
    async with AsyncSessionLocal() as session:
        task = await session.get(MonitorTask, uuid.UUID(task_id))
        if not task:
            return {"status": "skipped", "reason": "task_not_found"}
        task.next_run_at = None
        try:
            await _zset_remove_task(task_id)
        except Exception as exc:
            logger.warning("monitor_schedule_zset_remove_failed task_id={} err={}", task_id, exc)
        await session.commit()
        return {"status": "removed", "task_id": task_id}
