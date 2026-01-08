"""
Bandit 报表 API 测试
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import ProviderPreset, ProviderPresetItem
from app.repositories.bandit_repository import BanditRepository
from tests.api.conftest import AsyncSessionLocal


async def _seed_bandit_data():
    async with AsyncSessionLocal() as session:
        # 复用已存在的 preset，否则创建
        existing = await session.execute(
            select(ProviderPreset).where(ProviderPreset.slug == "bandit-test")
        )
        preset = existing.scalars().first()
        if not preset:
            preset = ProviderPreset(
                id=uuid.uuid4(),
                name="bandit-test",
                slug="bandit-test",
                provider="mock-provider",
                base_url="https://mock.provider",
                auth_type="none",
                auth_config={},
                default_headers={},
                default_params={},
            )
            session.add(preset)
            await session.flush()

        existing_item = (
            await session.execute(
                select(ProviderPresetItem).where(
                    ProviderPresetItem.preset_id == preset.id,
                    ProviderPresetItem.capability == "chat",
                    ProviderPresetItem.model == "gpt-4o",
                )
            )
        ).scalars().first()

        if existing_item:
            item = existing_item
        else:
            item = ProviderPresetItem(
                id=uuid.uuid4(),
                preset_id=preset.id,
                capability="chat",
                model="gpt-4o",
                upstream_path="/v1/chat",
                channel="internal",
                weight=100,
                priority=1,
                routing_config={"strategy": "bandit", "epsilon": 0.2},
            )
            session.add(item)
            await session.commit()

        repo = BanditRepository(session)
        # 写入两次反馈：1 成功 1 失败，便于校验统计
        await repo.record_feedback(
            preset_item_id=str(item.id),
            success=True,
            latency_ms=120,
            cost=0.01,
            reward=1.0,
            routing_config={"epsilon": 0.2},
        )
        await repo.record_feedback(
            preset_item_id=str(item.id),
            success=False,
            latency_ms=240,
            cost=0.01,
            reward=0.0,
            routing_config={"epsilon": 0.2},
        )

        return str(item.id)


@pytest.mark.asyncio
async def test_bandit_report_returns_metrics(client: AsyncClient, admin_tokens: dict):
    preset_item_id = await _seed_bandit_data()

    resp = await client.get(
        "/api/v1/internal/bandit/report",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["summary"]["total_trials"] >= 2
    assert data["summary"]["total_arms"] >= 1
    assert any(item["preset_item_id"] == preset_item_id for item in data["items"])
    # 校验关键观测指标存在
    target = next(item for item in data["items"] if item["preset_item_id"] == preset_item_id)
    assert target["success_rate"] >= 0.0
    assert target["avg_latency_ms"] >= 0.0
