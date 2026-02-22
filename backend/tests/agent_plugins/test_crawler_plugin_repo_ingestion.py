import logging
import sys
import types

import pytest

from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin


def test_crawler_plugin_tools_include_repo_ingestion():
    plugin = CrawlerPlugin()
    tools = plugin.get_tools()
    assert any(
        tool.get("function", {}).get("name") == "submit_repo_ingestion"
        for tool in tools
    )


class _DummyContext:
    def get_logger(self, name=None):
        return logging.getLogger(name or "crawler-test")


class _DummyAsyncSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _DummyRepo:
    def __init__(self, _session):
        pass


@pytest.mark.asyncio
async def test_handle_crawl_website_reads_review_ids(monkeypatch):
    plugin = CrawlerPlugin()
    plugin._context = _DummyContext()

    class _FakeService:
        def __init__(self, _repo):
            pass

        async def ingest_deep_dive(self, **_kwargs):
            return {"review_ids": ["id-1", "id-2"]}

    monkeypatch.setattr(
        "app.agent_plugins.builtins.crawler.plugin.AsyncSessionLocal",
        lambda: _DummyAsyncSession(),
    )
    monkeypatch.setattr(
        "app.repositories.knowledge_repository.KnowledgeRepository",
        _DummyRepo,
    )
    fake_pkg = types.ModuleType("app.services.knowledge")
    fake_pkg.__path__ = []
    fake_submodule = types.ModuleType("app.services.knowledge.crawler_knowledge_service")
    fake_submodule.CrawlerKnowledgeService = _FakeService
    fake_pkg.crawler_knowledge_service = fake_submodule
    monkeypatch.setitem(sys.modules, "app.services.knowledge", fake_pkg)
    monkeypatch.setitem(
        sys.modules,
        "app.services.knowledge.crawler_knowledge_service",
        fake_submodule,
    )

    result = await plugin.handle_crawl_website(url="https://example.com")

    assert result["status"] == "success"
    assert result["artifact_ids"] == ["id-1", "id-2"]
    assert "2 pages" in result["message"]


@pytest.mark.asyncio
async def test_handle_crawl_website_fallback_to_ingested_ids(monkeypatch):
    plugin = CrawlerPlugin()
    plugin._context = _DummyContext()

    class _FakeService:
        def __init__(self, _repo):
            pass

        async def ingest_deep_dive(self, **_kwargs):
            return {"ingested_ids": ["legacy-id"]}

    monkeypatch.setattr(
        "app.agent_plugins.builtins.crawler.plugin.AsyncSessionLocal",
        lambda: _DummyAsyncSession(),
    )
    monkeypatch.setattr(
        "app.repositories.knowledge_repository.KnowledgeRepository",
        _DummyRepo,
    )
    fake_pkg = types.ModuleType("app.services.knowledge")
    fake_pkg.__path__ = []
    fake_submodule = types.ModuleType("app.services.knowledge.crawler_knowledge_service")
    fake_submodule.CrawlerKnowledgeService = _FakeService
    fake_pkg.crawler_knowledge_service = fake_submodule
    monkeypatch.setitem(sys.modules, "app.services.knowledge", fake_pkg)
    monkeypatch.setitem(
        sys.modules,
        "app.services.knowledge.crawler_knowledge_service",
        fake_submodule,
    )

    result = await plugin.handle_crawl_website(url="https://example.com")

    assert result["status"] == "success"
    assert result["artifact_ids"] == ["legacy-id"]
