# 使 Celery 自动发现 conversation 相关任务
from app.tasks import audit, billing, conversation  # noqa: F401
