from typing import Any

from app.core.celery_app import celery_app
from app.core.logging import logger


@celery_app.task(name="app.tasks.upstream.call_upstream", bind=True)
def call_upstream_task(self, service_name: str, payload: dict[str, Any]):
    """
    重试型上游调用任务
    """
    logger.info(f"Calling upstream service {service_name}")
    try:
        # TODO: 调用上游服务
        pass
    except Exception as e:
        logger.error(f"Upstream call failed: {e}")
        raise self.retry(exc=e)
