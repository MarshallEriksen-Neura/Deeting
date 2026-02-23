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
async def test_monitoring_latency_uses_ttft_fallback_and_ignores_zero(AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        model_name = "latency-fallback-test-model"
        session.add_all(
            [
                GatewayLog(
                    user_id=None,
                    model=model_name,
                    status_code=200,
                    duration_ms=0,
                    ttft_ms=None,
                    input_tokens=5,
                    output_tokens=5,
                    total_tokens=10,
                    cost_user=0.0,
                    cost_upstream=0.0,
                    created_at=now,
                ),
                GatewayLog(
                    user_id=None,
                    model=model_name,
                    status_code=200,
                    duration_ms=1200,
                    ttft_ms=None,
                    input_tokens=5,
                    output_tokens=5,
                    total_tokens=10,
                    cost_user=0.0,
                    cost_upstream=0.0,
                    created_at=now - timedelta(minutes=2),
                ),
                GatewayLog(
                    user_id=None,
                    model=model_name,
                    status_code=200,
                    duration_ms=2000,
                    ttft_ms=400,
                    input_tokens=5,
                    output_tokens=5,
                    total_tokens=10,
                    cost_user=0.0,
                    cost_upstream=0.0,
                    created_at=now - timedelta(minutes=1),
                ),
            ]
        )
        await session.commit()

        svc = MonitoringService(session)
        await cache.clear_prefix("mon:")

        heatmap = await svc.get_latency_heatmap(None, "24h", model=model_name)
        assert len(heatmap.grid) == 24
        assert heatmap.peak_latency == 1200
        assert heatmap.median_latency == 800

        percentiles = await svc.get_percentile_trends(None, "24h", model=model_name)
        assert len(percentiles.timeline) == 24
        assert any(p.p99 > 1000 for p in percentiles.timeline)


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


@pytest.mark.asyncio
async def test_monitoring_filters_apply_across_services(AsyncSessionLocal):
    async with AsyncSessionLocal() as session:
        now = Datetime.now()
        key_a = uuid4()
        key_b = uuid4()
        session.add_all(
            [
                GatewayLog(
                    user_id=None,
                    api_key_id=key_a,
                    model="gpt-4o",
                    status_code=500,
                    error_code="UPSTREAM_TIMEOUT",
                    duration_ms=300,
                    ttft_ms=120,
                    input_tokens=20,
                    output_tokens=10,
                    total_tokens=30,
                    cost_user=2.0,
                    cost_upstream=1.0,
                    created_at=now,
                ),
                GatewayLog(
                    user_id=None,
                    api_key_id=key_b,
                    model="claude-3",
                    status_code=429,
                    error_code="RATE_LIMITED",
                    duration_ms=250,
                    ttft_ms=80,
                    input_tokens=15,
                    output_tokens=0,
                    total_tokens=15,
                    cost_user=1.0,
                    cost_upstream=0.5,
                    created_at=now - timedelta(minutes=5),
                ),
            ]
        )
        await session.commit()

        svc = MonitoringService(session)
        await cache.clear_prefix("mon:")

        model_only = await svc.get_model_cost_breakdown(
            None, "24h", model="gpt-4o"
        )
        assert len(model_only.models) == 1
        assert model_only.models[0].name == "gpt-4o"

        key_only = await svc.get_key_activity_ranking(
            None, "24h", 10, api_key=str(key_a)
        )
        assert len(key_only.keys) == 1
        assert key_only.keys[0].id == str(key_a)

        server_errors = await svc.get_error_distribution(
            None, "24h", error_code="5xx"
        )
        categories = {c.category: c.count for c in server_errors.categories}
        assert categories.get("5xx", 0) >= 1
        assert categories.get("429", 0) == 0
