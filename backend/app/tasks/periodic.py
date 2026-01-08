from loguru import logger

from app.core.celery_app import celery_app


@celery_app.task
def daily_cleanup_task():
    """
    示例：每日清理任务
    """
    logger.info("Running daily cleanup task...")
    # 这里添加清理逻辑，如清理临时文件、过期日志等
    return "Cleanup completed"

@celery_app.task
def heartbeat_task():
    """
    示例：每分钟心跳任务
    """
    logger.info("Celery Beat heartbeat...")
    return "Alive"
