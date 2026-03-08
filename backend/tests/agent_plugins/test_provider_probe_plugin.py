import logging
import uuid

import pytest

from app.agent_plugins.builtins.provider_probe.plugin import ProviderProbePlugin
from app.agent_plugins.core.interfaces import PluginContext


class DummyContext(PluginContext):
    def __init__(self, user_id: uuid.UUID):
        self._user_id = user_id

    @property
    def user_id(self) -> uuid.UUID:
        return self._user_id

    @property
    def session_id(self) -> str | None:
        return None

    @property
    def working_directory(self) -> str:
        return ""

    def get_logger(self, name: str | None = None):
        return logging.getLogger(name or "test")

    def get_db_session(self):
        return None

    def get_config(self, key: str, default=None):
        return default

    @property
    def memory(self):
        return None


@pytest.mark.asyncio
async def test_probe_provider_delegates_to_verify_credentials(monkeypatch):
    captured: dict[str, object] = {}

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeService:
        def __init__(self, session):
            captured["session"] = session

        async def verify_credentials(self, **kwargs):
            captured["kwargs"] = kwargs
            return {"success": True, "discovered_models": ["gpt-4o-mini"]}

    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_probe.plugin.AsyncSessionLocal",
        lambda: FakeSession(),
    )
    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_probe.plugin.ProviderInstanceService",
        FakeService,
    )

    plugin = ProviderProbePlugin()
    await plugin.initialize(DummyContext(uuid.uuid4()))

    result = await plugin.handle_probe_provider(
        provider_type="openai",
        base_url="https://api.openai.com",
        api_key="sk-test",
        model="gpt-4o-mini",
        capability="chat",
    )

    assert result["success"] is True
    assert result["provider_type"] == "openai"
    assert result["protocol"] == "openai"
    assert captured["kwargs"] == {
        "preset_slug": "openai",
        "base_url": "https://api.openai.com",
        "api_key": "sk-test",
        "model": "gpt-4o-mini",
        "protocol": "openai",
        "auto_append_v1": None,
        "resource_name": None,
        "deployment_name": None,
        "project_id": None,
        "region": None,
        "api_version": None,
    }
