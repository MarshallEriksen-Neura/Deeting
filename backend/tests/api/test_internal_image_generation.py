import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.models.image_generation import ImageGenerationOutput, ImageGenerationStatus, ImageGenerationTask
from app.models.media_asset import MediaAsset
from app.tasks.image_generation import process_image_generation_task
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_internal_image_generation_requires_auth(client: AsyncClient):
    resp = await client.post("/api/v1/internal/images/generations", json={"model": "gpt-image-1", "prompt": "hi"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_internal_image_generation_create_task(
    client: AsyncClient,
    auth_tokens: dict,
    monkeypatch,
):
    monkeypatch.setattr(process_image_generation_task, "delay", lambda *_args, **_kwargs: None)

    resp = await client.post(
        "/api/v1/internal/images/generations",
        json={
            "model": "gpt-image-1",
            "prompt": "draw a cat",
            "provider_model_id": str(uuid.uuid4()),
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "queued"
    assert data["deduped"] is False


@pytest.mark.asyncio
async def test_internal_image_generation_get_task_outputs(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
    monkeypatch,
):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")

    task_id = uuid.uuid4()
    asset_id = uuid.uuid4()
    output_id = uuid.uuid4()
    now = Datetime.now()

    async with AsyncSessionLocal() as session:
        session.add(
            MediaAsset(
                id=asset_id,
                content_hash="h" * 64,
                size_bytes=10,
                content_type="image/png",
                object_key="assets/generated/demo.png",
                etag=None,
                uploader_user_id=uuid.UUID(test_user["id"]),
                expire_at=now + timedelta(days=30),
            )
        )
        session.add(
            ImageGenerationTask(
                id=task_id,
                user_id=uuid.UUID(test_user["id"]),
                tenant_id=uuid.UUID(test_user["id"]),
                api_key_id=uuid.UUID(test_user["id"]),
                model="gpt-image-1",
                prompt_raw="draw",
                negative_prompt=None,
                prompt_hash="x" * 64,
                status=ImageGenerationStatus.SUCCEEDED,
                completed_at=now,
            )
        )
        session.add(
            ImageGenerationOutput(
                id=output_id,
                task_id=task_id,
                output_index=0,
                media_asset_id=asset_id,
                source_url=None,
                seed=123,
                content_type="image/png",
                size_bytes=10,
                width=1024,
                height=1024,
                meta={},
            )
        )
        await session.commit()

    resp = await client.get(
        f"/api/v1/internal/images/generations/{task_id}",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "succeeded"
    assert data["outputs"]
    assert data["outputs"][0]["asset_url"].startswith("http://test/api/v1/media/assets/")
