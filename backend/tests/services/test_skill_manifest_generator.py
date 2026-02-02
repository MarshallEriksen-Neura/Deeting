import pytest

from app.services.skill_registry.evidence_pack import EvidencePack
from app.services.skill_registry.manifest_generator import SkillManifestGenerator


@pytest.mark.asyncio
async def test_manifest_generator_parses_json(monkeypatch):
    async def fake_chat_completion(*args, **kwargs):
        return (
            "{\"name\":\"docx\",\"description\":\"docx tool\","
            "\"capabilities\":[\"docx\"],\"usage_spec\":{\"example_code\":\"print(1)\"}}"
        )

    monkeypatch.setattr(
        "app.services.skill_registry.manifest_generator.llm_service.chat_completion",
        fake_chat_completion,
    )

    evidence = EvidencePack(readme="docx", dependencies=["lxml"])
    manifest = await SkillManifestGenerator().generate(evidence, runtime="python_library")

    assert manifest["name"] == "docx"
