import uuid

import pytest

from app.services.memory.extractor import MemoryExtractorService


@pytest.mark.asyncio
async def test_llm_extract_facts_passes_user_identity_to_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    captured: dict = {}

    async def fake_resolve_secretary_model(*, db_session, user_id):
        assert db_session is not None
        assert user_id is not None
        return "Kimi-K2"

    async def fake_chat_completion(**kwargs):
        captured.update(kwargs)
        return '["fact-1"]'

    monkeypatch.setattr(
        "app.services.memory.external_memory._resolve_secretary_model",
        fake_resolve_secretary_model,
    )
    monkeypatch.setattr(
        "app.services.providers.llm.llm_service.chat_completion",
        fake_chat_completion,
    )

    fake_embedding = type("FakeEmbedding", (), {"model": "test-embedding"})()
    service = MemoryExtractorService(embedding_service=fake_embedding)
    facts = await service._llm_extract_facts(
        messages=[{"role": "user", "content": "hello"}],
        user_id=user_id,
        db_session=object(),
    )

    assert facts == ["fact-1"]
    assert captured["model"] == "Kimi-K2"
    assert captured["user_id"] == str(user_id)
    assert captured["tenant_id"] == str(user_id)
    assert captured["api_key_id"] == str(user_id)
