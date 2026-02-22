from typing import Any

from app.core.celery_app import celery_app
from app.core.http_client import create_sync_http_client
from app.core.logging import logger


@celery_app.task(name="app.tasks.callbacks.push_callback", bind=True)
def push_callback_task(self, url: str, payload: dict[str, Any]):
    """
    外部回调推送任务
    """
    logger.info(f"Pushing callback to {url}")
    try:
        with create_sync_http_client(timeout=10.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
        logger.info(f"Callback pushed successfully to {url}")
        return "Success"
    except Exception as e:
        logger.error(f"Callback push failed: {e}")
        raise self.retry(exc=e)
