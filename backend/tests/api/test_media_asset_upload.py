import hashlib

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.models.media_asset import MediaAsset
from app.services.oss.asset_storage_service import AssetObjectMeta


@pytest.mark.asyncio
async def test_media_asset_upload_init_deduped(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")
    monkeypatch.setattr(settings, "ASSET_STORAGE_MODE", "oss")

    content_hash = hashlib.sha256(b"hello").hexdigest()
    object_key = "assets/demo/2026/01/15/hello.png"

    async with AsyncSessionLocal() as session:
        asset = MediaAsset(
            content_hash=content_hash,
            size_bytes=5,
            content_type="image/png",
            object_key=object_key,
            etag="etag",
        )
        session.add(asset)
        await session.commit()

    async def fake_head(_object_key: str) -> AssetObjectMeta:
        return AssetObjectMeta(
            size_bytes=5,
            content_type="image/png",
            etag="etag",
            metadata={"sha256": content_hash},
        )

    monkeypatch.setattr("app.services.oss.asset_upload_service.head_asset_object", fake_head)

    resp = await client.post(
        "/api/v1/media/assets/upload/init",
        json={
            "content_hash": content_hash,
            "size_bytes": 5,
            "content_type": "image/png",
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["deduped"] is True
    assert data["object_key"] == object_key
    assert data["asset_url"].startswith("http://test/api/v1/media/assets/")


@pytest.mark.asyncio
async def test_media_asset_upload_init_requires_upload(
    client: AsyncClient,
    auth_tokens: dict,
    monkeypatch,
):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")
    monkeypatch.setattr(settings, "ASSET_STORAGE_MODE", "oss")

    content_hash = hashlib.sha256(b"new-file").hexdigest()

    async def fake_presign(**_kwargs):
        return (
            "assets/demo/2026/01/15/new.png",
            "https://oss.example.com/upload",
            600,
            {"Content-Type": "image/png", "x-oss-meta-sha256": content_hash},
        )

    monkeypatch.setattr("app.services.oss.asset_upload_service.presign_asset_put_url", fake_presign)

    resp = await client.post(
        "/api/v1/media/assets/upload/init",
        json={
            "content_hash": content_hash,
            "size_bytes": 8,
            "content_type": "image/png",
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["deduped"] is False
    assert data["upload_url"] == "https://oss.example.com/upload"
    assert data["upload_headers"]["Content-Type"] == "image/png"


@pytest.mark.asyncio
async def test_media_asset_upload_complete_creates_record(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")
    monkeypatch.setattr(settings, "ASSET_STORAGE_MODE", "oss")

    content_hash = hashlib.sha256(b"complete").hexdigest()
    object_key = "assets/demo/2026/01/15/complete.png"

    async def fake_head(_object_key: str) -> AssetObjectMeta:
        return AssetObjectMeta(
            size_bytes=12,
            content_type="image/png",
            etag="etag-complete",
            metadata={"sha256": content_hash},
        )

    monkeypatch.setattr("app.services.oss.asset_upload_service.head_asset_object", fake_head)

    resp = await client.post(
        "/api/v1/media/assets/upload/complete",
        json={
            "object_key": object_key,
            "content_hash": content_hash,
            "size_bytes": 12,
            "content_type": "image/png",
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["object_key"] == object_key
    assert data["asset_url"].startswith("http://test/api/v1/media/assets/")

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(MediaAsset).where(MediaAsset.content_hash == content_hash))
        asset = result.scalar_one_or_none()
        assert asset is not None
        assert asset.object_key == object_key


@pytest.mark.asyncio
async def test_media_asset_upload_complete_hash_mismatch(
    client: AsyncClient,
    auth_tokens: dict,
    monkeypatch,
):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")
    monkeypatch.setattr(settings, "ASSET_STORAGE_MODE", "oss")

    content_hash = hashlib.sha256(b"hash-a").hexdigest()
    object_key = "assets/demo/2026/01/15/bad.png"

    async def fake_head(_object_key: str) -> AssetObjectMeta:
        return AssetObjectMeta(
            size_bytes=4,
            content_type="image/png",
            etag="etag-bad",
            metadata={"sha256": hashlib.sha256(b"hash-b").hexdigest()},
        )

    monkeypatch.setattr("app.services.oss.asset_upload_service.head_asset_object", fake_head)

    resp = await client.post(
        "/api/v1/media/assets/upload/complete",
        json={
            "object_key": object_key,
            "content_hash": content_hash,
            "size_bytes": 4,
            "content_type": "image/png",
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 400
    assert "hash" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_media_asset_sign_endpoint(
    client: AsyncClient,
    auth_tokens: dict,
    monkeypatch,
):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")

    object_keys = [
        "assets/demo/2026/01/15/hello.png",
        "assets/demo/2026/01/16/world.png",
    ]

    resp = await client.post(
        "/api/v1/media/assets/sign",
        json={"object_keys": object_keys},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["assets"]) == len(object_keys)
    assert data["assets"][0]["object_key"] == object_keys[0]
    assert data["assets"][0]["asset_url"].startswith(
        "http://test/api/v1/media/assets/"
    )
