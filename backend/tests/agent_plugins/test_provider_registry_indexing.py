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
from tests.utils.provider_protocol_profiles import build_protocol_profiles

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
    def session_id(self) -> str | None:
        return None

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


class _FakeResponse:
    is_success = True
    status_code = 200
    text = '{"ok": true}'


class _FakeClient:
    def __init__(self) -> None:
        self.last_body = None
        self.last_headers = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, json: dict, headers: dict):
        self.last_body = json
        self.last_headers = headers
        return _FakeResponse()


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
                protocol_schema_version="2026-03-07",
                protocol_profiles=build_protocol_profiles(
                    provider="openai",
                    profile_configs={},
                ),
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


@pytest.mark.asyncio
async def test_verify_provider_template_supports_python_none_literals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_registry.plugin.AsyncSessionLocal",
        AsyncSessionLocal,
    )
    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_registry.plugin.is_safe_upstream_url",
        lambda *_: True,
    )

    fake_client = _FakeClient()
    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_registry.plugin.create_async_http_client",
        lambda **_: fake_client,
    )

    admin_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        session.add(
            User(
                id=admin_id,
                email="verify-admin@example.com",
                username="verify-admin",
                hashed_password="x",
                is_superuser=True,
            )
        )
        await session.commit()

    plugin = ProviderRegistryPlugin()
    await plugin.initialize(DummyContext(admin_id))
    result = await plugin.handle_verify_provider_template(
        base_url="https://example.com/v1/chat/completions",
        test_api_key="sk-test",
        request_template={"value": "{{ 1 if input.temperature is None else 0 }}"},
        test_payload={"temperature": None},
        header_template={"Authorization": "Bearer {{ api_key }}"},
    )

    assert "Template Rendering Failed" not in result
    assert fake_client.last_body == {"value": "1"}
    assert fake_client.last_headers == {"Authorization": "Bearer sk-test"}


@pytest.mark.asyncio
async def test_verify_provider_template_supports_input_namespace_with_tojson(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_registry.plugin.AsyncSessionLocal",
        AsyncSessionLocal,
    )
    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_registry.plugin.is_safe_upstream_url",
        lambda *_: True,
    )

    fake_client = _FakeClient()
    monkeypatch.setattr(
        "app.agent_plugins.builtins.provider_registry.plugin.create_async_http_client",
        lambda **_: fake_client,
    )

    admin_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        session.add(
            User(
                id=admin_id,
                email="verify-admin2@example.com",
                username="verify-admin2",
                hashed_password="x",
                is_superuser=True,
            )
        )
        await session.commit()

    plugin = ProviderRegistryPlugin()
    await plugin.initialize(DummyContext(admin_id))
    result = await plugin.handle_verify_provider_template(
        base_url="https://example.com/v1/chat/completions",
        test_api_key="sk-test",
        request_template={
            "model": "{{ input.model }}",
            "messages": "{{ input.messages | tojson }}",
            "stream": "{{ input.stream | default(false) | tojson }}",
        },
        test_payload={
            "model": "doubao-1-5-pro-32k-250115",
            "messages": [{"role": "user", "content": "你好"}],
            "stream": False,
        },
        header_template={"Authorization": "Bearer {{ api_key }}"},
    )

    assert "Template Rendering Failed" not in result
    assert fake_client.last_body == {
        "model": "doubao-1-5-pro-32k-250115",
        "messages": [{"role": "user", "content": "你好"}],
        "stream": False,
    }
