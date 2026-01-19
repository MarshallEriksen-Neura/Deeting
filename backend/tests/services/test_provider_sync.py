import uuid
import pytest

from app.models import Base, ProviderModel, ProviderInstance, ProviderPreset
from app.services.providers.provider_instance_service import ProviderInstanceService
from app.repositories.provider_instance_repository import ProviderModelRepository
from tests.api.conftest import AsyncSessionLocal, engine

import pytest_asyncio


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_sync_preserves_manual_overrides(monkeypatch):
    async with AsyncSessionLocal() as session:
        # 准备 preset 与实例
        preset = ProviderPreset(
            id=uuid.uuid4(),
            name="OpenAI",
            slug="openai",
            provider="openai",
            base_url="https://api.openai.com",
            auth_type="bearer",
            auth_config={"secret_ref_id": "ENV_OPENAI_KEY"},
            default_headers={},
            default_params={},
            is_active=True,
        )
        session.add(preset)
        await session.commit()

        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-sync",
            base_url="https://api.openai.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )

        # 先写入一条手工模型（source=manual），确保同步时不被覆盖
        manual_model = ProviderModel(
            id=uuid.uuid4(),
            instance_id=inst.id,
            capability="chat",
            model_id="gpt-4o",
            unified_model_id="gpt-4o",
            display_name="Custom GPT-4o",
            upstream_path="chat/completions",
            template_engine="simple_replace",
            request_template={},
            response_transform={},
            pricing_config={"input": 1},
            limit_config={},
            tokenizer_config={},
            routing_config={},
            source="manual",
            extra_meta={},
            weight=777,
            priority=0,
            is_active=True,
        )
        await svc.upsert_models(inst.id, None, [manual_model])

        # 模拟上游返回
        async def fake_fetch(*_args, **_kwargs):
            return [
                {"id": "gpt-4o"},
                {"id": "text-embedding-3-small"},
            ]

        monkeypatch.setattr(svc, "_fetch_models_from_upstream", fake_fetch)
        monkeypatch.setattr(svc, "_get_secret", lambda *args, **kwargs: "dummy")

        await svc.sync_models_from_upstream(inst.id, None, preserve_user_overrides=True)

        repo = ProviderModelRepository(session)
        models = await repo.get_by_instance_id(inst.id)
        by_id = {m.model_id: m for m in models}

        # 手工模型未被覆盖（display_name/weight 保留）
        assert by_id["gpt-4o"].display_name == "Custom GPT-4o"
        assert by_id["gpt-4o"].weight == 777
        # 新增的嵌入模型被写入且能力映射为 embedding
        assert by_id["text-embedding-3-small"].capability == "embedding"


@pytest.mark.asyncio
async def test_sync_dedupes_duplicate_models(monkeypatch):
    async with AsyncSessionLocal() as session:
        preset = ProviderPreset(
            id=uuid.uuid4(),
            name="OpenAI",
            slug="openai",
            provider="openai",
            base_url="https://api.openai.com",
            auth_type="bearer",
            auth_config={"secret_ref_id": "ENV_OPENAI_KEY"},
            default_headers={},
            default_params={},
            is_active=True,
        )
        session.add(preset)
        await session.commit()

        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-dedupe",
            base_url="https://api.openai.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )

        async def fake_fetch(*_args, **_kwargs):
            return [
                {"id": "openai/gpt-oss-120b"},
                {"id": "openai/gpt-oss-120b"},
            ]

        monkeypatch.setattr(svc, "_fetch_models_from_upstream", fake_fetch)
        monkeypatch.setattr(svc, "_get_secret", lambda *args, **kwargs: "dummy")

        await svc.sync_models_from_upstream(inst.id, None)

        repo = ProviderModelRepository(session)
        models = await repo.get_by_instance_id(inst.id)
        ids = [m.model_id for m in models]
        assert ids.count("openai/gpt-oss-120b") == 1
