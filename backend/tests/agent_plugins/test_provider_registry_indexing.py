import logging
import uuid
from unittest.mock import Mock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.agent_plugins.builtins.provider_registry.plugin import ProviderRegistryPlugin
from app.agent_plugins.core.interfaces import PluginContext
from app.models import Base
from app.models.provider_preset import ProviderPreset
from app.models.user import User

engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    echo=False,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


class DummyContext(PluginContext):
    def __init__(self, user_id: uuid.UUID):
        self._user_id = user_id

    @property
    def user_id(self) -> uuid.UUID:
        return self._user_id

    @property
    def working_directory(self) -> str:
        return ""

    def get_logger(self, name: str | None = None):
        return logging.getLogger(name or "test")

    def get_db_session(self):
        return None

    def get_config(self, key: str, default=None):
        return default

    @property
    def memory(self):
        return None


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def dispose_engine():
    yield
    await engine.dispose()


@pytest.mark.asyncio
async def test_save_provider_field_mapping_enqueues_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_registry.plugin.AsyncSessionLocal",
        AsyncSessionLocal,
    )
    enqueue = Mock()
    monkeypatch.setattr(
        "app.tasks.search_index.upsert_provider_preset_task.delay", enqueue
    )

    admin_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        session.add(
            User(
                id=admin_id,
                email="admin@example.com",
                username="admin",
                hashed_password="x",
                is_superuser=True,
            )
        )
        session.add(
            ProviderPreset(
                name="OpenAI",
                slug="openai",
                provider="openai",
                base_url="https://api.openai.com",
                auth_type="api_key",
                auth_config={},
                default_headers={},
                default_params={},
                capability_configs={},
                icon="lucide:cpu",
            )
        )
        await session.commit()

    plugin = ProviderRegistryPlugin()
    await plugin.initialize(DummyContext(admin_id))
    result = await plugin.handle_save_provider_field_mapping(
        provider_slug="openai",
        capability="chat",
        request_template={"model": "{{ input.model }}"},
    )

    assert result["status"] == "success"
    enqueue.assert_called_once_with("openai")
