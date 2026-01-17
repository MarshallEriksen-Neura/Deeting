from __future__ import annotations

from celery import Celery
from celery.schedules import crontab
from celery.signals import beat_init, worker_process_init

from app.core.config import settings
from app.core.logging import setup_logging

celery_app = Celery(
    "apiproxy",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_default_queue=settings.CELERY_TASK_DEFAULT_QUEUE,
    timezone=settings.CELERY_TIMEZONE,
    enable_utc=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],

    # Phase 12: Task Reliability & Monitoring
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_send_sent_event=True,

    # Phase 12: Retry & Rate Limit Policies
    task_annotations={
        "*": {
            "rate_limit": "100/s",
        },
        "app.tasks.billing.*": {
            "autoretry_for": (Exception,),
            "retry_backoff": True,
            "retry_backoff_max": 600,
            "retry_jitter": True,
            "max_retries": 5,
        },
        "app.tasks.async_inference.*": {
            "retry_backoff": True,
            "retry_jitter": True,
        }
    },

    # 定时任务配置
    beat_schedule={
        "heartbeat-every-minute": {
            "task": "app.tasks.periodic.heartbeat_task",
            "schedule": 60.0,  # 每 60 秒执行一次
        },
        "daily-cleanup-at-midnight": {
            "task": "app.tasks.periodic.daily_cleanup_task",
            "schedule": 86400.0,  # 每 24 小时执行一次 (也可以使用 crontab)
        },
        # Sync tasks (merged from celery_beat_config.py)
        "sync-all-quotas": {
            "task": "quota_sync.sync_all_quotas",
            "schedule": 300.0,  # 5 minutes
            "options": {"expires": 240},
        },
        "sync-all-apikey-budgets": {
            "task": "apikey_sync.sync_all_apikey_budgets",
            "schedule": 600.0,  # 10 minutes
            "options": {"expires": 540},
        },
        "sync-all-quotas-hourly": {
            "task": "quota_sync.sync_all_quotas",
            "schedule": crontab(minute=0),  # Hourly
            "options": {"expires": 3300},
        },
    },
    # 任务路由配置
    task_routes={
        "app.tasks.audit.*": {"queue": "internal"},
        "app.tasks.reports.*": {"queue": "internal"},
        "app.tasks.billing.*": {"queue": "billing"},
        "app.tasks.async_inference.*": {"queue": "external"},
        "app.tasks.callbacks.*": {"queue": "external"},
        "app.tasks.media.*": {"queue": "external"},
        "app.tasks.upstream.*": {"queue": "retry"},
        "*": {"queue": "default"},
    },
)

# 自动发现 app.tasks 下的任务
celery_app.autodiscover_tasks(["app"])


@worker_process_init.connect
def init_worker_logging(**kwargs):
    """
    在 Celery worker 进程初始化时配置应用日志。
    """
    setup_logging()


@beat_init.connect
def init_beat_logging(**kwargs):
    """
    在 Celery beat 进程初始化时配置应用日志。
    """
    setup_logging()
