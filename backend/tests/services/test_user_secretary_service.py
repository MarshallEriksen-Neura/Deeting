import uuid

import pytest
import pytest_asyncio

from app.models import Base, User
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.repositories import ProviderModelRepository, UserSecretaryRepository
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
            ProviderModelRepository(session),
        )

        secretary = await service.update_model(user_id=user.id, model_name="gpt-4o")
        assert secretary.model_name == "gpt-4o"


@pytest.mark.asyncio
async def test_update_secretary_model_with_public_provider():
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="secretary-public@example.com",
            hashed_password="hash",
        )
        session.add(user)
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
            ProviderModelRepository(session),
        )

        secretary = await service.update_model(user_id=user.id, model_name="gpt-4o")
        assert secretary.model_name == "gpt-4o"






