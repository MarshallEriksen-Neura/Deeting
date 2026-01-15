# 使 Celery 自动发现任务模块（按需在 Celery 配置里 include）
from app.tasks import audit, billing, notification  # noqa: F401
