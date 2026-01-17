import uuid

import pytest
import pytest_asyncio

from app.models import Base, User
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.secretary import SecretaryPhase
from app.repositories import ProviderModelRepository, SecretaryPhaseRepository, UserSecretaryRepository
from app.services.secretary.secretary_service import UserSecretaryService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_update_secretary_model_with_user_provider():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="secretary@example.com",
            hashed_password="hash",
        )
        session.add(user)
        phase = SecretaryPhase(name="default", description="test")
        session.add(phase)
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
            capability="chat",
            model_id="gpt-4o",
            upstream_path="/chat/completions",
        )
        session.add(model)
        await session.commit()

        service = UserSecretaryService(
            UserSecretaryRepository(session),
            SecretaryPhaseRepository(session),
            ProviderModelRepository(session),
        )

        secretary = await service.update_model(user_id=user.id, model_name="gpt-4o")
        assert secretary.model_name == "gpt-4o"


@pytest.mark.asyncio
async def test_update_secretary_model_rejects_public_provider():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="secretary-public@example.com",
            hashed_password="hash",
        )
        session.add(user)
        phase = SecretaryPhase(name="default-public", description="test")
        session.add(phase)
        await session.commit()

        instance = ProviderInstance(
            user_id=None,
            preset_slug="openai",
            name="Public Provider",
            base_url="https://api.example.com",
            credentials_ref="secret_ref",
        )
        session.add(instance)
        await session.commit()

        model = ProviderModel(
            instance_id=instance.id,
            capability="chat",
            model_id="gpt-4o",
            upstream_path="/chat/completions",
        )
        session.add(model)
        await session.commit()

        service = UserSecretaryService(
            UserSecretaryRepository(session),
            SecretaryPhaseRepository(session),
            ProviderModelRepository(session),
        )

        with pytest.raises(ValueError, match="模型不可用或不属于当前用户"):
            await service.update_model(user_id=user.id, model_name="gpt-4o")


@pytest.mark.asyncio
async def test_update_secretary_embedding_model_with_user_provider():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="secretary-embed@example.com",
            hashed_password="hash",
        )
        session.add(user)
        phase = SecretaryPhase(name="default-embed", description="test")
        session.add(phase)
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
            capability="embedding",
            model_id="text-embedding-3-small",
            upstream_path="/embeddings",
        )
        session.add(model)
        await session.commit()

        service = UserSecretaryService(
            UserSecretaryRepository(session),
            SecretaryPhaseRepository(session),
            ProviderModelRepository(session),
        )

        secretary = await service.update_settings(
            user_id=user.id,
            embedding_model="text-embedding-3-small",
        )
        assert secretary.embedding_model == "text-embedding-3-small"


@pytest.mark.asyncio
async def test_update_secretary_embedding_model_rejects_public_provider():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="secretary-embed-public@example.com",
            hashed_password="hash",
        )
        session.add(user)
        phase = SecretaryPhase(name="default-embed-public", description="test")
        session.add(phase)
        await session.commit()

        instance = ProviderInstance(
            user_id=None,
            preset_slug="openai",
            name="Public Provider",
            base_url="https://api.example.com",
            credentials_ref="secret_ref",
        )
        session.add(instance)
        await session.commit()

        model = ProviderModel(
            instance_id=instance.id,
            capability="embedding",
            model_id="text-embedding-3-small",
            upstream_path="/embeddings",
        )
        session.add(model)
        await session.commit()

        service = UserSecretaryService(
            UserSecretaryRepository(session),
            SecretaryPhaseRepository(session),
            ProviderModelRepository(session),
        )

        with pytest.raises(ValueError, match="Embedding 模型不可用或不属于当前用户"):
            await service.update_settings(
                user_id=user.id,
                embedding_model="text-embedding-3-small",
            )


@pytest.mark.asyncio
async def test_update_topic_naming_model_with_user_provider():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="topic-naming@example.com",
            hashed_password="hash",
        )
        session.add(user)
        phase = SecretaryPhase(name="default-topic", description="test")
        session.add(phase)
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
            capability="chat",
            model_id="gpt-4o-mini",
            upstream_path="/chat/completions",
        )
        session.add(model)
        await session.commit()

        service = UserSecretaryService(
            UserSecretaryRepository(session),
            SecretaryPhaseRepository(session),
            ProviderModelRepository(session),
        )

        secretary = await service.update_settings(
            user_id=user.id,
            topic_naming_model="gpt-4o-mini",
        )
        assert secretary.topic_naming_model == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_update_topic_naming_model_rejects_public_provider():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="topic-naming-public@example.com",
            hashed_password="hash",
        )
        session.add(user)
        phase = SecretaryPhase(name="default-topic-public", description="test")
        session.add(phase)
        await session.commit()

        instance = ProviderInstance(
            user_id=None,
            preset_slug="openai",
            name="Public Provider",
            base_url="https://api.example.com",
            credentials_ref="secret_ref",
        )
        session.add(instance)
        await session.commit()

        model = ProviderModel(
            instance_id=instance.id,
            capability="chat",
            model_id="gpt-4o-mini",
            upstream_path="/chat/completions",
        )
        session.add(model)
        await session.commit()

        service = UserSecretaryService(
            UserSecretaryRepository(session),
            SecretaryPhaseRepository(session),
            ProviderModelRepository(session),
        )

        with pytest.raises(ValueError, match="话题自动命名模型不可用或不属于当前用户"):
            await service.update_settings(
                user_id=user.id,
                topic_naming_model="gpt-4o-mini",
            )
