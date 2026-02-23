import logging
import sys
import types
import uuid
from types import SimpleNamespace

import pytest

from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin


def test_crawler_plugin_tools_include_repo_ingestion():
    plugin = CrawlerPlugin()
    tools = plugin.get_tools()
    assert any(
        tool.get("function", {}).get("name") == "submit_repo_ingestion"
        for tool in tools
    )
    assert any(
        tool.get("function", {}).get("name") == "batch_convert_artifact_to_assistants"
        for tool in tools
    )
    convert_tool = next(
        tool for tool in tools if tool.get("function", {}).get("name") == "convert_artifact_to_assistant"
    )
    assert (
        convert_tool["function"]["parameters"]["properties"]["target_scope"]["default"]
        == "user"
    )


class _DummyContext:
    def __init__(self, user_id=None):
        self.user_id = user_id

    def get_logger(self, name=None):
        return logging.getLogger(name or "crawler-test")


class _DummyAsyncSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def commit(self):
        return None


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


@pytest.mark.asyncio
async def test_resolve_owner_user_id_user_scope_returns_actor():
    plugin = CrawlerPlugin()
    actor_id = uuid.uuid4()
    plugin._context = _DummyContext(user_id=actor_id)

    owner_user_id = await plugin._resolve_owner_user_id(
        target_scope="user",
        session=object(),
    )

    assert owner_user_id == actor_id


@pytest.mark.asyncio
async def test_resolve_owner_user_id_system_scope_requires_superuser(monkeypatch):
    plugin = CrawlerPlugin()
    plugin._context = _DummyContext(user_id=uuid.uuid4())

    class _FakeUserRepo:
        def __init__(self, _session):
            pass

        async def get_by_id(self, _user_id):
            return SimpleNamespace(is_superuser=False)

    monkeypatch.setattr("app.repositories.user_repository.UserRepository", _FakeUserRepo)

    with pytest.raises(PermissionError):
        await plugin._resolve_owner_user_id(
            target_scope="system",
            session=object(),
        )


@pytest.mark.asyncio
async def test_resolve_owner_user_id_system_scope_returns_none_for_superuser(monkeypatch):
    plugin = CrawlerPlugin()
    plugin._context = _DummyContext(user_id=uuid.uuid4())

    class _FakeUserRepo:
        def __init__(self, _session):
            pass

        async def get_by_id(self, _user_id):
            return SimpleNamespace(is_superuser=True)

    monkeypatch.setattr("app.repositories.user_repository.UserRepository", _FakeUserRepo)

    owner_user_id = await plugin._resolve_owner_user_id(
        target_scope="system",
        session=object(),
    )

    assert owner_user_id is None
