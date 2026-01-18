import uuid

import pytest

from app.core.config import settings
from app.models import Base
from app.repositories.upstream_secret_repository import UpstreamSecretRepository
from app.services.secrets.manager import SecretManager
from tests.api.conftest import AsyncSessionLocal, engine


@pytest.mark.asyncio
async def test_secret_manager_store_and_get_roundtrip(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")

    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        manager = SecretManager()
        ref = await manager.store("custom", "sk-test-1234", session)
        assert ref.startswith("db:")

        raw = await manager.get("custom", ref, session)
        assert raw == "sk-test-1234"

        secret_id = uuid.UUID(ref[3:])
        repo = UpstreamSecretRepository(session)
        record = await repo.get(secret_id)
        assert record is not None
        assert "sk-test-1234" not in record.encrypted_secret


@pytest.mark.asyncio
async def test_secret_manager_env_disabled_by_default(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")
    monkeypatch.setenv("ENV_CUSTOM_KEY", "sk-env-1234")

    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        manager = SecretManager()
        secret = await manager.get("custom", "ENV_CUSTOM_KEY", session)
        assert secret is None
