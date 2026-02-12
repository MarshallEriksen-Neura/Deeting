from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest
import yaml

import app.agent_plugins.builtins.database.plugin as database_plugin_module
from app.agent_plugins.builtins.database.plugin import DatabasePlugin


class _AsyncSessionCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _NoQuerySession:
    async def execute(self, *_args, **_kwargs):
        raise AssertionError("non-superuser should not query provider preset table")

    def add(self, *_args, **_kwargs):
        raise AssertionError("non-superuser should not add provider preset")

    async def commit(self):
        raise AssertionError("non-superuser should not commit")


class _NonSuperuserRepo:
    def __init__(self, _session):
        pass

    async def get_by_id(self, _user_id):
        return SimpleNamespace(is_superuser=False)


@pytest.mark.asyncio
async def test_create_provider_preset_requires_superuser(monkeypatch):
    plugin = DatabasePlugin()
    plugin._context = SimpleNamespace(user_id=uuid.uuid4())

    monkeypatch.setattr(
        database_plugin_module,
        "AsyncSessionLocal",
        lambda: _AsyncSessionCtx(_NoQuerySession()),
    )
    monkeypatch.setattr(database_plugin_module, "UserRepository", _NonSuperuserRepo)

    result = await plugin.create_provider_preset(
        name="XAI",
        slug="xai",
        base_url="https://api.x.ai/v1",
        auth_type="bearer",
    )

    assert result == plugin._ADMIN_ONLY_MESSAGE


@pytest.mark.asyncio
async def test_update_provider_preset_requires_superuser(monkeypatch):
    plugin = DatabasePlugin()
    plugin._context = SimpleNamespace(user_id=uuid.uuid4())

    monkeypatch.setattr(
        database_plugin_module,
        "AsyncSessionLocal",
        lambda: _AsyncSessionCtx(_NoQuerySession()),
    )
    monkeypatch.setattr(database_plugin_module, "UserRepository", _NonSuperuserRepo)

    result = await plugin.update_provider_preset(
        slug="xai",
        category="Cloud API",
    )

    assert result == plugin._ADMIN_ONLY_MESSAGE


def test_plugins_yaml_registers_database_manager_plugin():
    plugins_yaml = (
        Path(__file__).resolve().parents[2] / "app" / "core" / "plugins.yaml"
    )
    content = yaml.safe_load(plugins_yaml.read_text(encoding="utf-8"))

    plugin = next(
        (p for p in content.get("plugins", []) if p.get("id") == "system/database_manager"),
        None,
    )

    assert plugin is not None
    assert plugin.get("module") == "app.agent_plugins.builtins.database.plugin"
    assert plugin.get("class_name") == "DatabasePlugin"
    assert set(plugin.get("tools", [])) >= {
        "check_provider_preset_exists",
        "create_provider_preset",
        "update_provider_preset",
    }
