import importlib.util
import logging
from pathlib import Path
import uuid
from typing import Any

import pytest

from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin
from app.agent_plugins.core.interfaces import PluginContext


class DummyPluginContext(PluginContext):
    def __init__(self) -> None:
        self._user_id = uuid.uuid4()

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

    def get_config(self, key: str, default: Any = None) -> Any:
        return default

    @property
    def memory(self):
        return None


def _load_crawler_knowledge_module() -> Any:
    module_path = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "services"
        / "knowledge"
        / "crawler_knowledge_service.py"
    )
    spec = importlib.util.spec_from_file_location(
        "test_crawler_knowledge_service_module",
        module_path,
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_crawler_plugin_disables_env_proxy_for_scout(monkeypatch):
    captured: dict[str, Any] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "status": "success",
                "markdown": "# ok",
                "metadata": {"title": "t"},
            }

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json, timeout):
            captured["url"] = str(url)
            captured["json"] = json
            captured["timeout"] = timeout
            return FakeResponse()

    def fake_client_factory(*args, **kwargs):
        captured["factory_kwargs"] = kwargs
        return FakeClient()

    monkeypatch.setattr(
        "app.agent_plugins.builtins.crawler.plugin.create_async_http_client",
        fake_client_factory,
    )

    plugin = CrawlerPlugin()
    await plugin.initialize(DummyPluginContext())
    result = await plugin.handle_fetch_web_content(
        "https://example.com",
        js_mode=True,
    )

    assert result["status"] == "success"
    assert "trust_env" not in captured["factory_kwargs"]
    assert captured["url"].endswith("/v1/scout/inspect")
    assert captured["json"] == {"url": "https://example.com", "js_mode": True}
    assert captured["timeout"] == 60.0


@pytest.mark.asyncio
async def test_crawler_knowledge_service_disables_env_proxy_for_scout(monkeypatch):
    crawler_module = _load_crawler_knowledge_module()
    captured: dict[str, Any] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {"status": "completed", "artifacts": [], "topology": {}}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json, timeout):
            captured["url"] = str(url)
            captured["json"] = json
            captured["timeout"] = timeout
            return FakeResponse()

    def fake_client_factory(*args, **kwargs):
        captured["factory_kwargs"] = kwargs
        return FakeClient()

    monkeypatch.setattr(crawler_module, "create_async_http_client", fake_client_factory)

    service = crawler_module.CrawlerKnowledgeService(repository=object())
    result = await service.ingest_deep_dive(
        "https://example.com", max_depth=1, max_pages=1
    )

    assert result["status"] == "success"
    assert "trust_env" not in captured["factory_kwargs"]
    assert captured["url"].endswith("/v1/scout/deep-dive")
    assert captured["json"]["url"] == "https://example.com"
    assert captured["timeout"] == 600.0
