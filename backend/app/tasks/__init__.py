# 使 Celery 自动发现任务模块（按需在 Celery 配置里 include）
from app.tasks import (  # noqa: F401
    agent,
    apikey_sync,
    async_inference,
    audit,
    billing,
    callbacks,
    conversation,
    example,
    media,
    memory_tasks,
    notification,
    periodic,
    quota_sync,
    reports,
    upstream,
)
