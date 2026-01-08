from app.core.celery_app import celery_app
from app.core.logging import logger


@celery_app.task(name="app.tasks.media.process_media")
def process_media_task(file_path: str, operation: str):
    """
    大文本/音视频处理任务
    """
    logger.info(f"Processing media {file_path} with operation {operation}")
    # TODO: 实现具体的媒体处理逻辑
    return f"Processed {file_path}"
