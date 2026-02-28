import pytest
import sys
from types import SimpleNamespace

from app.services.skill_registry.evidence_pack import EvidencePack
from app.services.skill_registry.manifest_generator import SkillManifestGenerator


@pytest.mark.asyncio
async def test_manifest_generator_parses_json(monkeypatch):
    captured: dict = {}

    async def fake_chat_completion(*args, **kwargs):
        captured["kwargs"] = kwargs
        return (
            '{"name":"docx","description":"docx tool",'
            '"capabilities":["docx"],"usage_spec":{"example_code":"print(1)"}}'
        )

    monkeypatch.setitem(
        sys.modules,
        "app.services.providers.llm",
        SimpleNamespace(
            llm_service=SimpleNamespace(chat_completion=fake_chat_completion),
        ),
    )

    evidence = EvidencePack(readme="docx", dependencies=["lxml"])
    manifest = await SkillManifestGenerator().generate(
        evidence,
        runtime="python_library",
        user_id="123e4567-e89b-12d3-a456-426614174000",
    )

    assert manifest["name"] == "docx"
    assert captured["kwargs"]["user_id"] == "123e4567-e89b-12d3-a456-426614174000"
    assert captured["kwargs"]["tenant_id"] == "123e4567-e89b-12d3-a456-426614174000"
    assert captured["kwargs"]["api_key_id"] == "123e4567-e89b-12d3-a456-426614174000"
