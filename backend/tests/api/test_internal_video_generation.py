import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.image_generation import (
    GenerationTask,
    GenerationTaskType,
    ImageGenerationStatus,
)
from app.repositories.generation_task_repository import GenerationTaskRepository


@pytest.mark.asyncio
async def test_internal_video_generation_list_tasks_compat_legacy_repo_signature(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
    monkeypatch,
):
    def legacy_build_user_query(
        self,
        *,
        user_id,
        status: ImageGenerationStatus | None = None,
        session_id=None,
    ):
        stmt = (
            select(GenerationTask)
            .where(GenerationTask.user_id == user_id)
            .order_by(GenerationTask.created_at.desc(), GenerationTask.id.desc())
        )
        if status:
            stmt = stmt.where(GenerationTask.status == status)
        if session_id:
            stmt = stmt.where(GenerationTask.session_id == session_id)
        return stmt

    monkeypatch.setattr(
        GenerationTaskRepository,
        "build_user_query",
        legacy_build_user_query,
    )

    video_task_id = uuid.uuid4()
    image_task_id = uuid.uuid4()
    user_uuid = uuid.UUID(test_user["id"])

    async with AsyncSessionLocal() as session:
        session.add(
            GenerationTask(
                id=video_task_id,
                user_id=user_uuid,
                tenant_id=user_uuid,
                api_key_id=user_uuid,
                model="kling-v1",
                prompt_raw="video prompt",
                negative_prompt=None,
                prompt_hash="a" * 64,
                task_type=GenerationTaskType.VIDEO_GENERATION,
                status=ImageGenerationStatus.SUCCEEDED,
            )
        )
        session.add(
            GenerationTask(
                id=image_task_id,
                user_id=user_uuid,
                tenant_id=user_uuid,
                api_key_id=user_uuid,
                model="gpt-image-1",
                prompt_raw="image prompt",
                negative_prompt=None,
                prompt_hash="b" * 64,
                task_type=GenerationTaskType.IMAGE_GENERATION,
                status=ImageGenerationStatus.SUCCEEDED,
            )
        )
        await session.commit()

    resp = await client.get(
        "/api/v1/internal/videos/generations",
        params={"include_outputs": "false"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    ids = {item["task_id"] for item in data["items"]}
    assert str(video_task_id) in ids
    assert str(image_task_id) not in ids
