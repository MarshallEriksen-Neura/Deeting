import uuid

import pytest
import pytest_asyncio

from app.models import Base
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.repositories import ProviderModelRepository, SystemSettingRepository
from app.services.system_settings_service import SystemSettingsService
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_set_and_get_system_embedding_model():
    async with AsyncSessionLocal() as session:
        instance = ProviderInstance(
            user_id=None,
            preset_slug="openai",
            name="System Provider",
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

        service = SystemSettingsService(
            SystemSettingRepository(session),
            ProviderModelRepository(session),
        )

        model_name = await service.set_embedding_model("text-embedding-3-small")
        assert model_name == "text-embedding-3-small"

        loaded = await service.get_embedding_model()
        assert loaded == "text-embedding-3-small"
