import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest

from app.core.cache import cache
from app.models.gateway_log import GatewayLog
from app.models.provider_instance import ProviderInstance
from app.services.dashboard.dashboard_service import DashboardService
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_dashboard_stats(client, auth_tokens, AsyncSessionLocal):
    # 准备数据：今日两条 200，一条 500
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        logs = [
            GatewayLog(
                user_id=uuid4(),
                model="gpt-4o",
                status_code=200,
                duration_ms=1000,
                ttft_ms=200,
                input_tokens=100,
                output_tokens=50,
                total_tokens=150,
                cost_user=0.02,
                cost_upstream=0.01,
                created_at=now,
            ),
            GatewayLog(
                user_id=None,
                model="gpt-4o",
                status_code=500,
                duration_ms=800,
                ttft_ms=300,
                input_tokens=80,
                output_tokens=30,
                total_tokens=110,
                cost_user=0.01,
                cost_upstream=0.01,
                created_at=now - timedelta(minutes=10),
            ),
        ]
        session.add_all(logs)
        await session.commit()

        svc = DashboardService(session)
        resp = await svc.get_stats(None)
        assert resp.traffic.today_requests >= 2
        assert resp.health.total_requests >= 2


@pytest.mark.asyncio
async def test_token_throughput(client, auth_tokens, AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        gl = GatewayLog(
            user_id=None,
            model="gpt-4o",
            status_code=200,
            duration_ms=100,
            ttft_ms=20,
            input_tokens=120,
            output_tokens=60,
            total_tokens=180,
            cost_user=0.01,
            cost_upstream=0.005,
            created_at=now - timedelta(hours=1),
        )
        session.add(gl)
        await session.commit()

        svc = DashboardService(session)
        resp = await svc.get_token_throughput(None, "24h")
        assert resp.total_input >= 120
        assert resp.total_output >= 60


@pytest.mark.asyncio
async def test_recent_errors(client, auth_tokens, AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        log = GatewayLog(
            user_id=None,
            model="gpt-4o",
            status_code=500,
            duration_ms=100,
            ttft_ms=20,
            input_tokens=10,
            output_tokens=0,
            total_tokens=10,
            cost_user=0.0,
            cost_upstream=0.0,
            created_at=now,
            error_code="TEST_ERR",
        )
        session.add(log)
        await session.commit()

        svc = DashboardService(session)
        items = await svc.get_recent_errors(None, limit=5)
        assert any(e.error_code == "TEST_ERR" for e in items)


@pytest.mark.asyncio
async def test_provider_health_uses_redis(client, auth_tokens, AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        inst = ProviderInstance(
            id=uuid4(),
            preset_slug="openai",
            name="default",
            base_url="https://api.example.com",
            credentials_ref="REF",
            priority=1,
            channel="external",
        )
        session.add(inst)
        await session.commit()

        # 写入伪造健康数据到 redis mock
        await cache._redis.hset(f"provider:health:{inst.id}", mapping={"status": b"active", "latency": 123})  # type: ignore[attr-defined]
        await cache._redis.rpush(f"provider:health:{inst.id}:history", 10, 20, 30)  # type: ignore[attr-defined]

        svc = DashboardService(session)
        res = await svc.get_provider_health(None)
        assert len(res) == 1
        assert res[0].status == "active"
        assert res[0].sparkline == [10, 20, 30]


@pytest.mark.asyncio
async def test_smart_router_stats_handles_non_numeric_meta(client, auth_tokens, AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        logs = [
            GatewayLog(
                user_id=None,
                model="gpt-4o",
                status_code=200,
                duration_ms=100,
                ttft_ms=20,
                input_tokens=10,
                output_tokens=5,
                total_tokens=15,
                cost_user=0.01,
                cost_upstream=0.005,
                created_at=now,
                meta={"routing": {"affinity_saved_tokens_est": "not-a-number"}},
            ),
            GatewayLog(
                user_id=None,
                model="gpt-4o",
                status_code=200,
                duration_ms=120,
                ttft_ms=25,
                input_tokens=12,
                output_tokens=6,
                total_tokens=18,
                cost_user=0.012,
                cost_upstream=0.006,
                created_at=now - timedelta(minutes=1),
                meta={"routing": {"affinity_saved_tokens_est": "5"}},
            ),
        ]
        session.add_all(logs)
        await session.commit()

        svc = DashboardService(session)
        resp = await svc.get_smart_router_stats(None)
        assert resp.avg_speedup >= 0
