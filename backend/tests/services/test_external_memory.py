import uuid

import pytest

from app.services.memory import external_memory


@pytest.mark.asyncio
async def test_should_persist_llm_positive(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_classify(text: str, *, model: str | None):
        return True, 0.9

    monkeypatch.setattr(external_memory, "_classify_with_llm", fake_classify)
    result = await external_memory.should_persist_text(
        "我喜欢喝咖啡",
        record_sample=False,
    )
    assert result is True


@pytest.mark.asyncio
async def test_should_persist_llm_negative(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_classify(text: str, *, model: str | None):
        return False, 0.2

    monkeypatch.setattr(external_memory, "_classify_with_llm", fake_classify)
    result = await external_memory.should_persist_text(
        "今天天气不错",
        record_sample=False,
    )
    assert result is False


@pytest.mark.asyncio
async def test_should_persist_llm_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_classify(text: str, *, model: str | None):
        return None, None

    monkeypatch.setattr(external_memory, "_classify_with_llm", fake_classify)
    result = await external_memory.should_persist_text(
        "随便聊聊",
        record_sample=False,
    )
    assert result is False


def test_derive_external_user_id_is_stable() -> None:
    uid1 = external_memory.derive_external_user_id("sk-test-123")
    uid2 = external_memory.derive_external_user_id("sk-test-123")
    uid3 = external_memory.derive_external_user_id("sk-test-456")

    assert isinstance(uid1, uuid.UUID)
    assert uid1 == uid2
    assert uid1 != uid3
