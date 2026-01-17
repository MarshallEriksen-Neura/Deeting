from loguru import logger
import asyncio

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.providers.health_monitor import HealthMonitorService
from app.core.cache import cache


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

@celery_app.task
def check_providers_health_task():
    """
    Periodic task to check health of all provider instances.
    """
    logger.info("Starting check_providers_health_task...")
    
    async def _run():
        async with AsyncSessionLocal() as session:
            # Ensure Redis is init if running in worker process that didn't init it
            if not cache._redis and cache._redis is None:
                cache.init()
            
            svc = HealthMonitorService(cache.redis)
            await svc.check_all_instances(session)
    
    try:
        asyncio.run(_run())
        return "Health check completed"
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return f"Failed: {e}"
