from loguru import logger
import asyncio

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.providers.health_monitor import HealthMonitorService
from app.repositories.media_asset_repository import MediaAssetRepository
from app.services.oss.asset_storage_service import get_effective_asset_storage_mode
from app.utils.time_utils import Datetime
from app.core.cache import cache


@celery_app.task
def daily_cleanup_task():
    """
    示例：每日清理任务
    """
    logger.info("Running daily cleanup task...")
    if get_effective_asset_storage_mode() == "local":
        return "Cleanup skipped (local storage)"

    async def _run():
        async with AsyncSessionLocal() as session:
            repo = MediaAssetRepository(session)
            now = Datetime.now()
            expired_assets = await repo.delete_expired(now, commit=False)
            if expired_assets:
                logger.info("media_asset_expired_records=%s", expired_assets)
            await session.commit()

    try:
        asyncio.run(_run())
        return "Cleanup completed"
    except Exception as exc:
        logger.error(f"Cleanup failed: {exc}")
        return f"Failed: {exc}"

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
