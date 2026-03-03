import uuid
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.schemas.tool import ToolDefinition
from app.services.tools.tool_sync_service import ToolSyncService


class FakeEmbeddingService:
    async def embed_text(self, text: str):  # pragma: no cover - simple async helper
        return [0.1, 0.2]


@pytest.mark.asyncio
async def test_search_tools_prefers_user_hits(monkeypatch):
    service = ToolSyncService(embedding_service=FakeEmbeddingService())

    async def fake_search_system(*_args, **_kwargs):
        return [
            {
                "payload": {
                    "tool_name": "tool_b",
                    "description": "sys",
                    "schema_json": {},
                }
            },
            {
                "payload": {
                    "tool_name": "tool_a",
                    "description": "sys",
                    "schema_json": {},
                }
            },
        ]

    async def fake_search_user(*_args, **_kwargs):
        return [
            {
                "payload": {
                    "tool_name": "tool_b",
                    "description": "user",
                    "schema_json": {},
                }
            },
            {
                "payload": {
                    "tool_name": "tool_c",
                    "description": "user",
                    "schema_json": {},
                }
            },
        ]

    async def fake_search_skills(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(service, "_search_system", fake_search_system)
    monkeypatch.setattr(service, "_search_user", fake_search_user)
    monkeypatch.setattr(service, "_search_skills", fake_search_skills)

    result = await service.search_tools("find tools", user_id=uuid.uuid4())
    names = [tool.name for tool in result]
    assert names == ["tool_b", "tool_c", "tool_a"]


@pytest.mark.asyncio
async def test_search_tools_empty_query_returns_empty(monkeypatch):
    service = ToolSyncService(embedding_service=FakeEmbeddingService())
    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    result = await service.search_tools("", user_id=uuid.uuid4())
    assert result == []


def test_hit_to_def_accepts_schema_string():
    service = ToolSyncService()
    hit = {
        "payload": {"tool_name": "tool_x", "description": "demo", "schema_json": "{}"}
    }
    tool = service._hit_to_def(hit)
    assert isinstance(tool, ToolDefinition)
    assert tool.name == "tool_x"
    assert tool.input_schema == {}


@pytest.mark.asyncio
async def test_search_tools_reranks_skill_hits(monkeypatch):
    class FakeDecisionService:
        def __init__(self, order: list[str]) -> None:
            self._order = order

        async def rank_candidates(self, _scene: str, candidates):
            return sorted(candidates, key=lambda c: self._order.index(c.arm_id))

    class FakeEmbeddingService:
        async def embed_text(self, _text: str):
            return [0.1]

    async def fake_search_skills(*_args, **_kwargs):
        return [
            {"score": 0.81, "payload": {"skill_id": "a", "description": "A"}},
            {"score": 0.80, "payload": {"skill_id": "b", "description": "B"}},
        ]

    service = ToolSyncService(
        embedding_service=FakeEmbeddingService(),
        decision_service=FakeDecisionService(order=["skill__b", "skill__a"]),
    )

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )

    async def fake_search_system(*_args, **_kwargs):
        return []

    monkeypatch.setattr(service, "_search_system", fake_search_system)
    monkeypatch.setattr(service, "_search_skills", fake_search_skills)
    skill_tools = {"a": "tool_from_a", "b": "tool_from_b"}

    async def fake_get_by_id(_self, skill_id: str):
        tool_name = skill_tools.get(str(skill_id))
        if not tool_name:
            return None
        return SimpleNamespace(
            id=str(skill_id),
            runtime="opensandbox",
            source_repo="https://github.com/org/repo",
            manifest_json={"tools": [{"name": tool_name, "description": tool_name}]},
        )

    monkeypatch.setattr(
        "app.repositories.skill_registry_repository.SkillRegistryRepository.get_by_id",
        fake_get_by_id,
    )

    result = await service.search_tools("do something")
    assert [tool.name for tool in result] == ["tool_from_b", "tool_from_a"]
    assert result[0].extra_meta and result[0].extra_meta.get("origin") == "skill"


@pytest.mark.asyncio
async def test_search_tools_rerank_uses_decision_config(monkeypatch):
    captured: dict[str, object] = {}

    class FakeDecisionService:
        def __init__(self, _repo, **kwargs) -> None:
            captured.update(kwargs)

        async def rank_candidates(self, _scene: str, candidates):
            return candidates

    class DummySession:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def fake_session_factory():
        return DummySession()

    async def fake_search_skills(*_args, **_kwargs):
        return [{"score": 0.81, "payload": {"skill_id": "a", "description": "A"}}]

    service = ToolSyncService(embedding_service=FakeEmbeddingService())

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.DecisionService",
        FakeDecisionService,
    )
    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.AsyncSessionLocal",
        fake_session_factory,
    )
    monkeypatch.setattr(service, "_search_skills", fake_search_skills)

    async def fake_search_system(*_args, **_kwargs):
        return []

    monkeypatch.setattr(service, "_search_system", fake_search_system)

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.settings",
        settings,
    )
    monkeypatch.setattr(settings, "DECISION_STRATEGY", "ucb")
    monkeypatch.setattr(settings, "DECISION_FINAL_SCORE", "bandit_only")
    monkeypatch.setattr(settings, "DECISION_VECTOR_WEIGHT", 0.9)
    monkeypatch.setattr(settings, "DECISION_BANDIT_WEIGHT", 0.1)
    monkeypatch.setattr(settings, "DECISION_EXPLORATION_BONUS", 0.2)
    monkeypatch.setattr(settings, "DECISION_UCB_C", 0.5)
    monkeypatch.setattr(settings, "DECISION_UCB_MIN_TRIALS", 3)
    monkeypatch.setattr(settings, "DECISION_THOMPSON_PRIOR_ALPHA", 2.0)
    monkeypatch.setattr(settings, "DECISION_THOMPSON_PRIOR_BETA", 3.0)
    async def fake_get_by_id(_self, skill_id: str):
        return SimpleNamespace(
            id=str(skill_id),
            runtime="opensandbox",
            source_repo="https://github.com/org/repo",
            manifest_json={"tools": [{"name": "tool_from_a", "description": "A"}]},
        )

    monkeypatch.setattr(
        "app.repositories.skill_registry_repository.SkillRegistryRepository.get_by_id",
        fake_get_by_id,
    )

    await service.search_tools("do something")

    assert captured["strategy"] == "ucb"
    assert captured["final_score"] == "bandit_only"
    assert captured["vector_weight"] == 0.9
    assert captured["bandit_weight"] == 0.1
    assert captured["exploration_bonus"] == 0.2
    assert captured["ucb_c"] == 0.5
    assert captured["ucb_min_trials"] == 3
    assert captured["thompson_prior_alpha"] == 2.0
    assert captured["thompson_prior_beta"] == 3.0


@pytest.mark.asyncio
async def test_search_tools_filters_repo_skills_by_installation(monkeypatch):
    service = ToolSyncService(embedding_service=FakeEmbeddingService())

    async def fake_search_system(*_args, **_kwargs):
        return []

    async def fake_search_user(*_args, **_kwargs):
        return []

    async def fake_search_skills(*_args, **_kwargs):
        return [
            {
                "payload": {
                    "skill_id": "core.tools.crawler",
                    "description": "system skill",
                }
            },
            {
                "payload": {
                    "skill_id": "plugin.a",
                    "description": "installed repo skill",
                    "source_repo": "https://github.com/org/a",
                }
            },
            {
                "payload": {
                    "skill_id": "plugin.b",
                    "description": "uninstalled repo skill",
                    "source_repo": "https://github.com/org/b",
                }
            },
        ]

    async def fake_rerank(skill_hits):
        return skill_hits

    async def fake_installed(_user_id):
        return {"plugin.a"}

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(service, "_search_system", fake_search_system)
    monkeypatch.setattr(service, "_search_user", fake_search_user)
    monkeypatch.setattr(service, "_search_skills", fake_search_skills)
    monkeypatch.setattr(service, "_rerank_skill_hits", fake_rerank)
    monkeypatch.setattr(service, "_list_user_installed_skill_ids", fake_installed)
    skill_payloads = {
        "core.tools.crawler": SimpleNamespace(
            id="core.tools.crawler",
            runtime="builtin",
            source_repo="",
            manifest_json={
                "tools": [{"name": "fetch_web_content", "description": "crawler"}]
            },
        ),
        "plugin.a": SimpleNamespace(
            id="plugin.a",
            runtime="opensandbox",
            source_repo="https://github.com/org/a",
            manifest_json={"tools": [{"name": "plugin_a_tool", "description": "A"}]},
        ),
        "plugin.b": SimpleNamespace(
            id="plugin.b",
            runtime="opensandbox",
            source_repo="https://github.com/org/b",
            manifest_json={"tools": [{"name": "plugin_b_tool", "description": "B"}]},
        ),
    }

    async def fake_get_by_id(_self, skill_id: str):
        return skill_payloads.get(str(skill_id))

    monkeypatch.setattr(
        "app.repositories.skill_registry_repository.SkillRegistryRepository.get_by_id",
        fake_get_by_id,
    )

    result = await service.search_tools("find plugin", user_id=uuid.uuid4())
    names = [tool.name for tool in result]
    assert names == ["fetch_web_content", "plugin_a_tool"]
    assert result[0].extra_meta and result[0].extra_meta.get("install_required") is False
    assert result[1].extra_meta and result[1].extra_meta.get("install_required") is True


@pytest.mark.asyncio
async def test_search_tools_truncates_long_query_for_embedding(monkeypatch):
    captured: dict[str, str] = {}

    class CapturingEmbeddingService:
        async def embed_text(self, text: str):
            captured["text"] = text
            return [0.1, 0.2]

    service = ToolSyncService(embedding_service=CapturingEmbeddingService())

    async def fake_search_system(*_args, **_kwargs):
        return []

    async def fake_search_skills(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(service, "_search_system", fake_search_system)
    monkeypatch.setattr(service, "_search_skills", fake_search_skills)

    long_query = "a" * 5000
    result = await service.search_tools(long_query)
    assert result == []
    prepared = captured["text"]
    assert len(prepared) <= service._QUERY_EMBED_MAX_CHARS
    assert prepared.startswith("a" * 2000)
    assert prepared.endswith("a" * 900)


@pytest.mark.asyncio
async def test_search_tools_fails_open_when_embedding_errors(monkeypatch):
    class BrokenEmbeddingService:
        async def embed_text(self, _text: str):
            raise RuntimeError("embedding upstream error status=500 body=Internal Server Error")

    service = ToolSyncService(embedding_service=BrokenEmbeddingService())
    monkeypatch.setattr(
        "app.services.tools.tool_sync_service.qdrant_is_configured",
        lambda: True,
    )

    result = await service.search_tools("query that should fail embedding")
    assert result == []
