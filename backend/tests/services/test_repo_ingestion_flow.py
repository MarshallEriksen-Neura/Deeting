from types import SimpleNamespace

import pytest

from app.services.skill_registry.parsers.node_parser import NodeRepoParser
from app.services.skill_registry.parsers.python_parser import PythonRepoParser
from app.services.skill_registry.repo_ingestion_service import RepoIngestionService


class FakeRepo:
    def __init__(self) -> None:
        self.items: dict[str, SimpleNamespace] = {}

    async def get_by_id(self, skill_id: str):
        return self.items.get(skill_id)

    async def create(self, payload: dict):
        obj = SimpleNamespace(**payload)
        self.items[payload["id"]] = obj
        return obj

    async def update(self, obj, payload: dict):
        for key, value in payload.items():
            setattr(obj, key, value)
        return obj


class FakeManifestGenerator:
    async def generate(self, *_args, **_kwargs):
        return {
            "name": "Docx Skill",
            "description": "docx parser",
            "capabilities": ["docx"],
            "usage_spec": {"example_code": "print(1)"},
        }


@pytest.mark.asyncio
async def test_repo_ingestion_flow(monkeypatch, tmp_path):
    (tmp_path / "requirements.txt").write_text("lxml", encoding="utf-8")
    (tmp_path / "README.md").write_text("docx", encoding="utf-8")

    monkeypatch.setattr(
        "app.services.skill_registry.repo_ingestion_service.clone_repo",
        lambda *_args, **_kwargs: (tmp_path, tmp_path),
    )

    service = RepoIngestionService(
        repo=FakeRepo(),
        manifest_generator=FakeManifestGenerator(),
        parsers=[PythonRepoParser(), NodeRepoParser()],
    )

    result = await service.ingest_repo(
        "https://example.com/repo.git",
        "main",
        skill_id="docx_skill",
        runtime_hint="python_library",
    )

    assert result["skill_id"] == "docx_skill"
