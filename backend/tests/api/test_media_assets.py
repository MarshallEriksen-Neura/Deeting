import uuid
from urllib.parse import urlsplit

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services.oss.asset_storage_service import build_signed_asset_url


@pytest.mark.asyncio
async def test_media_asset_local_success(client: AsyncClient, tmp_path, monkeypatch):
    # 配置为本地存储
    monkeypatch.setattr(settings, "ASSET_STORAGE_MODE", "local")
    monkeypatch.setattr(settings, "ASSET_LOCAL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "ASSET_OSS_PREFIX", "assets")
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")

    object_key = f"assets/demo/{uuid.uuid4().hex}.txt"
    file_path = tmp_path.joinpath(*object_key.split("/"))
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text("hello-asset")

    signed = build_signed_asset_url(object_key, base_url="http://testserver")
    parts = urlsplit(signed)
    resp = await client.get(f"{parts.path}?{parts.query}")

    assert resp.status_code == 200
    assert resp.text == "hello-asset"
    assert resp.headers.get("cache-control") == "no-store"


@pytest.mark.asyncio
async def test_media_asset_invalid_signature(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ASSET_STORAGE_MODE", "local")
    monkeypatch.setattr(settings, "ASSET_LOCAL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "ASSET_OSS_PREFIX", "assets")
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")

    object_key = f"assets/demo/{uuid.uuid4().hex}.txt"
    file_path = tmp_path.joinpath(*object_key.split("/"))
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text("hello-asset")

    signed = build_signed_asset_url(object_key, base_url="http://testserver")
    parts = urlsplit(signed)
    # 破坏签名
    resp = await client.get(f"{parts.path}?expires=1&sig=bad")

    assert resp.status_code == 403
    assert "invalid" in resp.json()["detail"] or "expired" in resp.json()["detail"]
