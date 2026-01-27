import uuid

import pytest
import pytest_asyncio

from app.models import Base, User
from app.models.conversation import ConversationChannel, ConversationSession, ConversationStatus
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.secretary import UserSecretary
from app.services.conversation.topic_namer import generate_conversation_title
from app.services.providers.provider_instance_service import ProviderInstanceService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_topic_naming_skips_without_config():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="topic-naming-empty@example.com",
            hashed_password="hash",
        )
        session.add(user)
        session_id = uuid.uuid4()
        session.add(
            ConversationSession(
                id=session_id,
                user_id=user.id,
                channel=ConversationChannel.INTERNAL,
                status=ConversationStatus.ACTIVE,
            )
        )
        await session.commit()

        result = await generate_conversation_title(
            session,
            session_id=str(session_id),
            user_id=str(user.id),
            first_message="测试话题命名",
        )

        stmt = await session.get(ConversationSession, session_id)
        assert result == "skip_unconfigured"
        assert stmt is not None
        assert stmt.title is None


@pytest.mark.asyncio
async def test_topic_naming_updates_title(monkeypatch):
    async def fake_test_model(self, model_id, user_id, prompt="ping"):
        return {
            "success": True,
            "response_body": {
                "choices": [
                    {"message": {"content": "旅行计划"}}
                ]
            },
        }

    monkeypatch.setattr(ProviderInstanceService, "test_model", fake_test_model)

    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="topic-naming@example.com",
            hashed_password="hash",
        )
        session.add(user)
        secretary = UserSecretary(
            user_id=user.id,
            name="My Secretary",
            model_name="gpt-4o-mini",
        )
        session.add(secretary)
        await session.commit()

        instance = ProviderInstance(
            user_id=user.id,
            preset_slug="openai",
            name="My Provider",
            base_url="https://api.example.com",
            credentials_ref="secret_ref",
        )
        session.add(instance)
        await session.commit()

        model = ProviderModel(
            instance_id=instance.id,
            capabilities=["chat"],
            model_id="gpt-4o-mini",
            upstream_path="/chat/completions",
        )
        session.add(model)
        await session.commit()

        session_id = uuid.uuid4()
        session.add(
            ConversationSession(
                id=session_id,
                user_id=user.id,
                channel=ConversationChannel.INTERNAL,
                status=ConversationStatus.ACTIVE,
            )
        )
        await session.commit()

        result = await generate_conversation_title(
            session,
            session_id=str(session_id),
            user_id=str(user.id),
            first_message="我想聊一次旅行计划",
        )

        session_obj = await session.get(ConversationSession, session_id)
        assert result == "ok"
        assert session_obj is not None
        assert session_obj.title == "旅行计划"
