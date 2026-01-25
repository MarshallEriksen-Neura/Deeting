import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient

from app.models.image_generation import GenerationTask, ImageGenerationOutput, ImageGenerationStatus
from app.models.media_asset import MediaAsset
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_internal_image_share_requires_auth(client: AsyncClient):
    task_id = uuid.uuid4()
    resp = await client.post(f"/api/v1/internal/images/generations/{task_id}/share")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_public_image_share_flow(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
):
    task_id = uuid.uuid4()
    asset_id = uuid.uuid4()
    output_id = uuid.uuid4()
    now = Datetime.now()

    async with AsyncSessionLocal() as session:
        session.add(
            MediaAsset(
                id=asset_id,
                content_hash="s" * 64,
                size_bytes=10,
                content_type="image/png",
                object_key="assets/generated/share.png",
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
                prompt_raw="share this image",
                negative_prompt=None,
                prompt_hash="x" * 64,
                status=ImageGenerationStatus.SUCCEEDED,
                completed_at=now,
                num_outputs=1,
                steps=30,
                cfg_scale=7.5,
                seed=123,
                width=1024,
                height=1024,
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

    share_resp = await client.post(
        f"/api/v1/internal/images/generations/{task_id}/share",
        json={"tags": ["城市", "#插画"]},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert share_resp.status_code == 200
    share_data = share_resp.json()
    share_id = share_data["share_id"]
    assert share_data["is_active"] is True
    assert share_data["prompt_encrypted"] is False
    assert set(share_data["tags"]) == {"#城市", "#插画"}

    list_resp = await client.get("/api/v1/public/images/shares")
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    matched = next(item for item in items if item["share_id"] == share_id)
    assert matched["prompt"] == "share this image"
    assert set(matched["tags"]) == {"#城市", "#插画"}
    assert matched["preview"]["asset_url"].startswith("http://test/api/v1/media/assets/")

    detail_resp = await client.get(f"/api/v1/public/images/shares/{share_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["share_id"] == share_id
    assert set(detail["tags"]) == {"#城市", "#插画"}
    assert detail["outputs"]
    assert detail["outputs"][0]["asset_url"].startswith("http://test/api/v1/media/assets/")


@pytest.mark.asyncio
async def test_public_share_hides_encrypted_prompt_and_unshare(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
):
    task_id = uuid.uuid4()
    asset_id = uuid.uuid4()
    output_id = uuid.uuid4()
    now = Datetime.now()

    async with AsyncSessionLocal() as session:
        session.add(
            MediaAsset(
                id=asset_id,
                content_hash="e" * 64,
                size_bytes=10,
                content_type="image/png",
                object_key="assets/generated/encrypted.png",
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
                prompt_raw="secret prompt",
                negative_prompt=None,
                prompt_hash="y" * 64,
                prompt_encrypted=True,
                prompt_ciphertext="cipher",
                status=ImageGenerationStatus.SUCCEEDED,
                completed_at=now,
                num_outputs=1,
            )
        )
        session.add(
            ImageGenerationOutput(
                id=output_id,
                task_id=task_id,
                output_index=0,
                media_asset_id=asset_id,
                source_url=None,
                seed=77,
                content_type="image/png",
                size_bytes=10,
                width=512,
                height=512,
                meta={},
            )
        )
        await session.commit()

    share_resp = await client.post(
        f"/api/v1/internal/images/generations/{task_id}/share",
        json={"tags": ["私密"]},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert share_resp.status_code == 200
    share_id = share_resp.json()["share_id"]

    detail_resp = await client.get(f"/api/v1/public/images/shares/{share_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["prompt"] is None
    assert detail["prompt_encrypted"] is True
    assert detail["tags"] == ["#私密"]

    unshare_resp = await client.delete(
        f"/api/v1/internal/images/generations/{task_id}/share",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert unshare_resp.status_code == 200
    assert unshare_resp.json()["is_active"] is False

    list_resp = await client.get("/api/v1/public/images/shares")
    assert list_resp.status_code == 200
    ids = {item["share_id"] for item in list_resp.json()["items"]}
    assert share_id not in ids
