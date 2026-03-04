from types import SimpleNamespace

import pytest

from app.services.assistant.skill_resolver import resolve_skill_refs


@pytest.mark.asyncio
async def test_resolve_skill_refs_uses_skill_registry_manifest(monkeypatch):
    skill_obj = SimpleNamespace(
        id="official.skills.crawler",
        runtime="builtin",
        manifest_json={
            "tools": [
                {
                    "name": "fetch_web_content",
                    "description": "Fetch web page",
                    "parameters": {"type": "object", "properties": {"url": {"type": "string"}}},
                }
            ]
        },
    )

    class _FakeSessionCtx:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class _FakeRepo:
        def __init__(self, _session):
            pass

        async def get_by_id(self, skill_id: str):
            if skill_id == "official.skills.crawler":
                return skill_obj
            return None

    monkeypatch.setattr("app.core.database.AsyncSessionLocal", lambda: _FakeSessionCtx())
    monkeypatch.setattr(
        "app.repositories.skill_registry_repository.SkillRegistryRepository", _FakeRepo
    )

    tools = await resolve_skill_refs([{"skill_id": "official.skills.crawler"}])

    assert len(tools) == 1
    assert tools[0].name == "fetch_web_content"
    assert tools[0].extra_meta == {
        "origin": "skill",
        "skill_id": "official.skills.crawler",
        "runtime": "builtin",
    }


@pytest.mark.asyncio
async def test_resolve_skill_refs_supports_legacy_skill_id_alias(monkeypatch):
    skill_obj = SimpleNamespace(
        id="official.skills.monitor",
        runtime="builtin",
        manifest_json={
            "tools": [
                {
                    "name": "sys_list_monitors",
                    "description": "List monitors",
                    "input_schema": {"type": "object", "properties": {}},
                }
            ]
        },
    )

    class _FakeSessionCtx:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class _FakeRepo:
        def __init__(self, _session):
            pass

        async def get_by_id(self, skill_id: str):
            if skill_id == "official.skills.monitor":
                return skill_obj
            return None

    monkeypatch.setattr("app.core.database.AsyncSessionLocal", lambda: _FakeSessionCtx())
    monkeypatch.setattr(
        "app.repositories.skill_registry_repository.SkillRegistryRepository", _FakeRepo
    )

    tools = await resolve_skill_refs([{"skill_id": "system/monitor"}])

    assert len(tools) == 1
    assert tools[0].name == "sys_list_monitors"

