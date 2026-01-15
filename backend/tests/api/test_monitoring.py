from datetime import timedelta
from uuid import uuid4

import pytest

from app.core.cache import cache
from app.models.gateway_log import GatewayLog
from app.services.monitoring.monitoring_service import MonitoringService
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_latency_heatmap_and_percentile(AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        # 写入 3 条不同延迟的日志
        session.add_all(
            [
                GatewayLog(
                    user_id=None,
                    model="gpt-4o",
                    status_code=200,
                    duration_ms=800,
                    ttft_ms=120,
                    input_tokens=10,
                    output_tokens=5,
                    total_tokens=15,
                    cost_user=0.01,
                    cost_upstream=0.005,
                    created_at=now,
                ),
                GatewayLog(
                    user_id=None,
                    model="gpt-4o",
                    status_code=200,
                    duration_ms=1500,
                    ttft_ms=300,
                    input_tokens=20,
                    output_tokens=10,
                    total_tokens=30,
                    cost_user=0.02,
                    cost_upstream=0.01,
                    created_at=now,
                ),
                GatewayLog(
                    user_id=None,
                    model="gpt-4o",
                    status_code=500,
                    duration_ms=2000,
                    ttft_ms=600,
                    input_tokens=15,
                    output_tokens=0,
                    total_tokens=15,
                    cost_user=0.0,
                    cost_upstream=0.0,
                    created_at=now,
                ),
            ]
        )
        await session.commit()

        svc = MonitoringService(session)
        await cache.clear_prefix("mon:")

        heatmap = await svc.get_latency_heatmap(None, "24h", None)
        assert len(heatmap.grid) == 24
        assert heatmap.peak_latency >= 600
        assert heatmap.median_latency > 0

        percentiles = await svc.get_percentile_trends(None, "24h")
        assert len(percentiles.timeline) == 24
        assert any(p.p99 > 0 for p in percentiles.timeline)


@pytest.mark.asyncio
async def test_model_cost_and_error_distribution(AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        session.add_all(
            [
                GatewayLog(
                    user_id=None,
                    model="gpt-4o",
                    status_code=200,
                    duration_ms=100,
                    ttft_ms=10,
                    input_tokens=10,
                    output_tokens=5,
                    total_tokens=15,
                    cost_user=1.0,
                    cost_upstream=0.5,
                    created_at=now,
                ),
                GatewayLog(
                    user_id=None,
                    model="claude-3",
                    status_code=500,
                    duration_ms=120,
                    ttft_ms=12,
                    input_tokens=8,
                    output_tokens=4,
                    total_tokens=12,
                    cost_user=3.0,
                    cost_upstream=1.0,
                    created_at=now,
                ),
                GatewayLog(
                    user_id=None,
                    model="claude-3",
                    status_code=429,
                    duration_ms=90,
                    ttft_ms=8,
                    input_tokens=5,
                    output_tokens=0,
                    total_tokens=5,
                    cost_user=2.0,
                    cost_upstream=1.0,
                    created_at=now,
                ),
            ]
        )
        await session.commit()

        svc = MonitoringService(session)
        await cache.clear_prefix("mon:")

        model_cost = await svc.get_model_cost_breakdown(None, "24h")
        assert len(model_cost.models) >= 2
        assert round(sum(m.percentage for m in model_cost.models), 1) <= 100.1

        err_dist = await svc.get_error_distribution(None, "24h")
        cats = {c.category: c.count for c in err_dist.categories}
        assert cats.get("5xx", 0) >= 1
        assert cats.get("429", 0) >= 1


@pytest.mark.asyncio
async def test_key_activity_ranking(AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        user_id = uuid4()
        api_key_id = uuid4()
        session.add_all(
            [
                GatewayLog(
                    user_id=user_id,
                    api_key_id=api_key_id,
                    model="gpt-4o",
                    status_code=200,
                    duration_ms=100 + i,
                    ttft_ms=10 + i,
                    input_tokens=10,
                    output_tokens=5,
                    total_tokens=15,
                    cost_user=0.1,
                    cost_upstream=0.05,
                    created_at=now - timedelta(seconds=i),
                )
                for i in range(20)
            ]
        )
        await session.commit()

        svc = MonitoringService(session)
        await cache.clear_prefix("mon:")

        ranking = await svc.get_key_activity_ranking(None, "24h", 5)
        assert ranking.keys
        assert ranking.keys[0].rpm > 0
