from __future__ import annotations

from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services.plugin_ui_bundle_storage import (
    get_bundle_ready_marker,
    get_plugin_ui_bundle_dir,
)
from app.services.plugin_ui_gateway_service import PluginUiGatewayService


class _FakeSkillRepo:
    def __init__(self, skill):
        self.skill = skill

    async def get_by_id(self, _skill_id: str):
        return self.skill


class _FakeInstallRepo:
    def __init__(self, install):
        self.install = install

    async def get_by_user_skill(self, _user_id: uuid.UUID, _skill_id: str):
        return self.install


@pytest.mark.asyncio
async def test_issue_renderer_session_and_resolve_asset(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "SECRET_KEY", "test-secret")
    monkeypatch.setattr(settings, "REPO_INGESTION_WORKDIR", str(tmp_path / "workdir"))

    bundle_dir = get_plugin_ui_bundle_dir("com.example.stock", "main")
    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / "index.html").write_text("<html>ok</html>", encoding="utf-8")
    get_bundle_ready_marker(bundle_dir).write_text("ready", encoding="utf-8")

    skill = SimpleNamespace(
        id="com.example.stock",
        status="active",
        source_repo="https://github.com/acme/stock.git",
        source_revision="main",
        manifest_json={"ui_bundle": {"renderer_asset_path": "index.html"}},
    )
    install = SimpleNamespace(is_enabled=True, installed_revision="main")
    service = PluginUiGatewayService(
        skill_repo=_FakeSkillRepo(skill),
        install_repo=_FakeInstallRepo(install),
    )

    session = await service.issue_renderer_session(
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        skill_id="com.example.stock",
        base_url="https://deeting.example.com",
        ttl_seconds=300,
    )

    assert "/api/v1/plugin-market/ui/t/" in session.renderer_url
    token_and_path = session.renderer_url.split("/api/v1/plugin-market/ui/t/", 1)[1]
    token, asset_path = token_and_path.split("/", 1)
    resolved = await service.resolve_asset(token=token, asset_path=asset_path)
    assert resolved.file_path.name == "index.html"
    assert resolved.content_type == "text/html"


@pytest.mark.asyncio
async def test_resolve_asset_blocks_path_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "SECRET_KEY", "test-secret")
    monkeypatch.setattr(settings, "REPO_INGESTION_WORKDIR", str(tmp_path / "workdir"))

    bundle_dir = get_plugin_ui_bundle_dir("com.example.stock", "main")
    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / "index.html").write_text("<html>ok</html>", encoding="utf-8")
    get_bundle_ready_marker(bundle_dir).write_text("ready", encoding="utf-8")

    skill = SimpleNamespace(
        id="com.example.stock",
        status="active",
        source_repo="https://github.com/acme/stock.git",
        source_revision="main",
        manifest_json={"ui_bundle": {"renderer_asset_path": "index.html"}},
    )
    install = SimpleNamespace(is_enabled=True, installed_revision="main")
    service = PluginUiGatewayService(
        skill_repo=_FakeSkillRepo(skill),
        install_repo=_FakeInstallRepo(install),
    )
    session = await service.issue_renderer_session(
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        skill_id="com.example.stock",
        base_url="https://deeting.example.com",
        ttl_seconds=300,
    )
    token = session.renderer_url.split("/api/v1/plugin-market/ui/t/", 1)[1].split("/", 1)[0]

    with pytest.raises(HTTPException, match="access denied"):
        await service.resolve_asset(token=token, asset_path="../secret.txt")


@pytest.mark.asyncio
async def test_resolve_asset_blocks_hidden_marker_file(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "SECRET_KEY", "test-secret")
    monkeypatch.setattr(settings, "REPO_INGESTION_WORKDIR", str(tmp_path / "workdir"))

    bundle_dir = get_plugin_ui_bundle_dir("com.example.stock", "main")
    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / "index.html").write_text("<html>ok</html>", encoding="utf-8")
    get_bundle_ready_marker(bundle_dir).write_text("ready", encoding="utf-8")

    skill = SimpleNamespace(
        id="com.example.stock",
        status="active",
        source_repo="https://github.com/acme/stock.git",
        source_revision="main",
        manifest_json={"ui_bundle": {"renderer_asset_path": "index.html"}},
    )
    install = SimpleNamespace(is_enabled=True, installed_revision="main")
    service = PluginUiGatewayService(
        skill_repo=_FakeSkillRepo(skill),
        install_repo=_FakeInstallRepo(install),
    )
    session = await service.issue_renderer_session(
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        skill_id="com.example.stock",
        base_url="https://deeting.example.com",
        ttl_seconds=300,
    )
    token = session.renderer_url.split("/api/v1/plugin-market/ui/t/", 1)[1].split("/", 1)[0]

    with pytest.raises(HTTPException, match="access denied"):
        await service.resolve_asset(token=token, asset_path=".bundle_ready")
