from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.video_generation.service import VideoGenerationService


@celery_app.task(name="app.tasks.video_generation.generate_video")
async def generate_video(task_id: str) -> None:
    async with AsyncSessionLocal() as session:
        service = VideoGenerationService(session)
        await service.process_task(task_id)
