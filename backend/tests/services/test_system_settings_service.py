
import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.models import Base
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.system_setting import SystemSetting
from app.repositories import ProviderModelRepository, SystemSettingRepository
from app.services.system import SystemSettingsService
from app.services.system.system_settings_service import EMBEDDING_SETTING_KEY
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
            capabilities=["embedding"],
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


@pytest.mark.asyncio
async def test_get_embedding_model_returns_none_when_not_configured():
    async with AsyncSessionLocal() as session:
        await session.execute(
            delete(SystemSetting).where(SystemSetting.key == EMBEDDING_SETTING_KEY)
        )
        await session.commit()
        service = SystemSettingsService(
            SystemSettingRepository(session),
            ProviderModelRepository(session),
        )
        loaded = await service.get_embedding_model()
        assert loaded is None
