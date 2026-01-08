from loguru import logger

from app.core.celery_app import celery_app


@celery_app.task
def add(x: int, y: int) -> int:
    """
    Example task to add two numbers.
    """
    logger.info(f"Adding {x} + {y}")
    return x + y

@celery_app.task
def check_health() -> str:
    """
    Simple health check task.
    """
    logger.info("Celery worker is healthy")
    return "OK"
