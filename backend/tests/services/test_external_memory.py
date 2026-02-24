import uuid

import pytest

from app.services.memory import external_memory


@pytest.mark.asyncio
async def test_should_persist_llm_positive(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_resolve_secretary_model(*, db_session, user_id):
        assert db_session is not None
        assert user_id is not None
        return "Kimi-K2"

    async def fake_classify(
        text: str, *, model: str | None, user_id: uuid.UUID | None = None
    ):
        assert model == "Kimi-K2"
        assert user_id is not None
        return True, 0.9

    monkeypatch.setattr(
        external_memory, "_resolve_secretary_model", fake_resolve_secretary_model
    )
    monkeypatch.setattr(external_memory, "_classify_with_llm", fake_classify)
    result = await external_memory.should_persist_text(
        "我喜欢喝咖啡",
        user_id=uuid.uuid4(),
        db_session=object(),
        record_sample=False,
    )
    assert result is True


@pytest.mark.asyncio
async def test_should_persist_llm_negative(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_resolve_secretary_model(*, db_session, user_id):
        assert db_session is not None
        assert user_id is not None
        return "Kimi-K2"

    async def fake_classify(
        text: str, *, model: str | None, user_id: uuid.UUID | None = None
    ):
        assert model == "Kimi-K2"
        assert user_id is not None
        return False, 0.2

    monkeypatch.setattr(
        external_memory, "_resolve_secretary_model", fake_resolve_secretary_model
    )
    monkeypatch.setattr(external_memory, "_classify_with_llm", fake_classify)
    result = await external_memory.should_persist_text(
        "今天天气不错",
        user_id=uuid.uuid4(),
        db_session=object(),
        record_sample=False,
    )
    assert result is False


@pytest.mark.asyncio
async def test_should_persist_llm_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_resolve_secretary_model(*, db_session, user_id):
        assert db_session is not None
        assert user_id is not None
        return "Kimi-K2"

    async def fake_classify(
        text: str, *, model: str | None, user_id: uuid.UUID | None = None
    ):
        assert model == "Kimi-K2"
        assert user_id is not None
        return None, None

    monkeypatch.setattr(
        external_memory, "_resolve_secretary_model", fake_resolve_secretary_model
    )
    monkeypatch.setattr(external_memory, "_classify_with_llm", fake_classify)
    result = await external_memory.should_persist_text(
        "随便聊聊",
        user_id=uuid.uuid4(),
        db_session=object(),
        record_sample=False,
    )
    assert result is False


@pytest.mark.asyncio
async def test_should_persist_skip_when_secretary_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_secretary_model(*, db_session, user_id):
        assert db_session is not None
        assert user_id is not None
        return None

    async def fake_classify(*args, **kwargs):  # pragma: no cover
        raise AssertionError("should not call llm classify when secretary is missing")

    monkeypatch.setattr(
        external_memory, "_resolve_secretary_model", fake_resolve_secretary_model
    )
    monkeypatch.setattr(external_memory, "_classify_with_llm", fake_classify)

    result = await external_memory.should_persist_text(
        "不应该触发记忆提取",
        user_id=uuid.uuid4(),
        db_session=object(),
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
