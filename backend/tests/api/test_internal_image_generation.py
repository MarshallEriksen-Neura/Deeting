import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.models.image_generation import GenerationTask, ImageGenerationOutput, ImageGenerationStatus
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
    session_id = uuid.uuid4()
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
            GenerationTask(
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


@pytest.mark.asyncio
async def test_internal_image_generation_list_tasks(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
):
    task_id = uuid.uuid4()
    encrypted_task_id = uuid.uuid4()
    other_task_id = uuid.uuid4()
    asset_id = uuid.uuid4()
    output_id = uuid.uuid4()
    session_id = uuid.uuid4()
    now = Datetime.now()

    async with AsyncSessionLocal() as session:
        session.add(
            MediaAsset(
                id=asset_id,
                content_hash="a" * 64,
                size_bytes=10,
                content_type="image/png",
                object_key="assets/generated/list.png",
                etag=None,
                uploader_user_id=uuid.UUID(test_user["id"]),
                expire_at=now + timedelta(days=30),
            )
        )
        session.add(
            GenerationTask(
                id=task_id,
                user_id=uuid.UUID(test_user["id"]),
                tenant_id=uuid.UUID(test_user["id"]),
                api_key_id=uuid.UUID(test_user["id"]),
                session_id=session_id,
                model="gpt-image-1",
                prompt_raw="draw a city",
                negative_prompt=None,
                prompt_hash="x" * 64,
                status=ImageGenerationStatus.SUCCEEDED,
                completed_at=now,
            )
        )
        session.add(
            GenerationTask(
                id=encrypted_task_id,
                user_id=uuid.UUID(test_user["id"]),
                tenant_id=uuid.UUID(test_user["id"]),
                api_key_id=uuid.UUID(test_user["id"]),
                session_id=session_id,
                model="gpt-image-1",
                prompt_raw="secret prompt",
                negative_prompt=None,
                prompt_hash="y" * 64,
                prompt_encrypted=True,
                prompt_ciphertext="cipher",
                status=ImageGenerationStatus.FAILED,
                completed_at=now,
                error_message="failed",
            )
        )
        session.add(
            GenerationTask(
                id=other_task_id,
                user_id=uuid.uuid4(),
                tenant_id=uuid.uuid4(),
                api_key_id=uuid.uuid4(),
                model="gpt-image-1",
                prompt_raw="other user",
                negative_prompt=None,
                prompt_hash="z" * 64,
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
                seed=42,
                content_type="image/png",
                size_bytes=10,
                width=512,
                height=512,
                meta={},
            )
        )
        await session.commit()

    resp = await client.get(
        "/api/v1/internal/images/generations",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    items = data["items"]
    ids = {item["task_id"] for item in items}
    assert str(task_id) in ids
    assert str(encrypted_task_id) in ids
    assert str(other_task_id) not in ids

    task_item = next(item for item in items if item["task_id"] == str(task_id))
    assert task_item["prompt"] == "draw a city"
    assert task_item["session_id"] == str(session_id)
    assert task_item["preview"]["asset_url"].startswith("http://test/api/v1/media/assets/")

    encrypted_item = next(item for item in items if item["task_id"] == str(encrypted_task_id))
    assert encrypted_item["prompt"] is None
    assert encrypted_item["prompt_encrypted"] is True

    resp = await client.get(
        "/api/v1/internal/images/generations",
        params={"session_id": str(session_id)},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    session_items = resp.json()["items"]
    session_ids = {item["task_id"] for item in session_items}
    assert str(task_id) in session_ids
    assert str(encrypted_task_id) in session_ids
    assert str(other_task_id) not in session_ids


@pytest.mark.asyncio
async def test_internal_image_generation_cancel_task(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
):
    task_id = uuid.uuid4()
    request_id = "req-image-cancel-001"
    now = Datetime.now()

    async with AsyncSessionLocal() as session:
        session.add(
            GenerationTask(
                id=task_id,
                user_id=uuid.UUID(test_user["id"]),
                tenant_id=uuid.UUID(test_user["id"]),
                api_key_id=uuid.UUID(test_user["id"]),
                model="gpt-image-1",
                prompt_raw="draw something",
                negative_prompt=None,
                prompt_hash="x" * 64,
                request_id=request_id,
                status=ImageGenerationStatus.RUNNING,
                started_at=now,
            )
        )
        await session.commit()

    resp = await client.post(
        f"/api/v1/internal/images/generations/{request_id}/cancel",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "canceled"
    assert data["request_id"] == request_id

    async with AsyncSessionLocal() as session:
        task = await session.get(GenerationTask, task_id)
        assert task is not None
        assert task.status == ImageGenerationStatus.CANCELED
        assert task.completed_at is not None


@pytest.mark.asyncio
async def test_internal_image_generation_cancel_terminal_task(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
):
    task_id = uuid.uuid4()
    request_id = "req-image-cancel-terminal-001"
    now = Datetime.now()

    async with AsyncSessionLocal() as session:
        session.add(
            GenerationTask(
                id=task_id,
                user_id=uuid.UUID(test_user["id"]),
                tenant_id=uuid.UUID(test_user["id"]),
                api_key_id=uuid.UUID(test_user["id"]),
                model="gpt-image-1",
                prompt_raw="done",
                negative_prompt=None,
                prompt_hash="y" * 64,
                request_id=request_id,
                status=ImageGenerationStatus.SUCCEEDED,
                completed_at=now,
            )
        )
        await session.commit()

    resp = await client.post(
        f"/api/v1/internal/images/generations/{request_id}/cancel",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "canceled"
    assert data["request_id"] == request_id

    async with AsyncSessionLocal() as session:
        task = await session.get(GenerationTask, task_id)
        assert task is not None
        assert task.status == ImageGenerationStatus.SUCCEEDED
