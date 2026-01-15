from __future__ import annotations

import math
from datetime import UTC, timedelta
from statistics import median
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.models.gateway_log import GatewayLog
from app.schemas.monitoring import (
    ErrorCategoryItem,
    ErrorDistributionResponse,
    KeyActivityItem,
    KeyActivityRankingResponse,
    LatencyHeatmapCell,
    LatencyHeatmapResponse,
    ModelCostBreakdownResponse,
    ModelCostItem,
    PercentilePoint,
    PercentileTrendsResponse,
)
from app.utils.time_utils import Datetime


class MonitoringService:
    """监控页数据聚合服务，含 Redis 缓存与简易降级。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self._dialect = getattr(getattr(session, "bind", None), "dialect", None)

    # -------- Latency Heatmap --------
    async def get_latency_heatmap(
        self,
        tenant_id: str | None,
        time_range: str,
        model: str | None = None,
    ) -> LatencyHeatmapResponse:
        cache_key = CacheKeys.monitoring_latency_heatmap(tenant_id, time_range, model)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        since = self._window_start(now, time_range)
        window_seconds = (now - since).total_seconds()
        bucket_count = 24  # 与前端 24 列布局保持一致
        row_count = 20

        stmt = select(GatewayLog.created_at, GatewayLog.ttft_ms, GatewayLog.duration_ms).where(
            GatewayLog.created_at >= since,
            GatewayLog.created_at <= now,
        )
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        if model:
            stmt = stmt.where(GatewayLog.model == model)

        rows = (await self.session.execute(stmt)).all()

        # 准备数据结构
        grid: list[list[dict[str, float | int]]] = [
            [{"count": 0, "intensity": 0.0} for _ in range(row_count)] for _ in range(bucket_count)
        ]

        # 先收集所有样本，基于全局分位数确定步长，避免早期极值导致分桶漂移
        samples: list[tuple[float, float]] = []  # (delta_seconds, latency)
        latencies: list[float] = []
        if rows:
            bucket_width = window_seconds / bucket_count
            for created_at, ttft_ms, duration_ms in rows:
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=UTC)
                latency = float(ttft_ms or duration_ms or 0)
                latencies.append(latency)
                delta = (created_at - since).total_seconds()
                col = int(min(bucket_count - 1, max(0, math.floor(delta / bucket_width))))
                samples.append((col, latency))

            # 使用 P95 限制步长上限，减少极端值干扰
            p95_latency = self._percentile(latencies, 95)
            scale_max = p95_latency or max(latencies) or 1.0
            step = max(1.0, scale_max / row_count)

            for col, latency in samples:
                row = int(min(row_count - 1, max(0, latency // step)))
                grid[col][row]["count"] = grid[col][row].get("count", 0) + 1

        peak_latency = max(latencies) if latencies else 0.0
        median_latency = float(median(latencies)) if latencies else 0.0
        max_count = max((cell["count"] for col in grid for cell in col), default=0)

        # 归一化 intensity
        for col in grid:
            for cell in col:
                if max_count > 0:
                    cell["intensity"] = round(cell["count"] / max_count, 4)

        resp = LatencyHeatmapResponse(
            grid=[
                [LatencyHeatmapCell(intensity=float(c["intensity"]), count=int(c["count"])) for c in col]
                for col in grid
            ],
            peak_latency=peak_latency,
            median_latency=median_latency,
        )
        await cache.set(cache_key, resp, ttl=60)
        return resp

    # -------- Percentile Trends --------
    async def get_percentile_trends(
        self,
        tenant_id: str | None,
        time_range: str,
    ) -> PercentileTrendsResponse:
        cache_key = CacheKeys.monitoring_percentile(tenant_id, time_range)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        since = self._window_start(now, time_range)
        bucket_fmt, bucket_count, bucket_label = self._bucket_params(time_range)

        # 优先使用数据库分位数（PostgreSQL 支持 percentile_cont），否则回退 Python 计算
        if self._dialect and self._dialect.name == "postgresql":
            bucket_expr = self._time_bucket(bucket_fmt)
            stmt = (
                select(
                    bucket_expr.label("bucket"),
                    func.percentile_cont(0.5).within_group(GatewayLog.ttft_ms).label("p50"),
                    func.percentile_cont(0.99).within_group(GatewayLog.ttft_ms).label("p99"),
                )
                .where(GatewayLog.created_at >= since, GatewayLog.created_at <= now)
                .group_by(bucket_expr)
                .order_by(bucket_expr)
            )
            if tenant_id:
                stmt = stmt.where(GatewayLog.user_id == tenant_id)
            rows = (await self.session.execute(stmt)).all()
            bucket_map = {row.bucket: (float(row.p50 or 0), float(row.p99 or 0)) for row in rows}
            timeline = []
            cursor = since
            for _ in range(bucket_count):
                label = bucket_label(cursor, bucket_fmt)
                key = label if bucket_fmt != "%H" else label[:2]
                p50, p99 = bucket_map.get(key, (0.0, 0.0))
                timeline.append(PercentilePoint(time=label, p50=p50, p99=p99))
                cursor += timedelta(hours=1 if bucket_fmt == "%H" else 24)
        else:
            window_seconds = (now - since).total_seconds()
            bucket_width = window_seconds / bucket_count
            stmt = select(GatewayLog.created_at, GatewayLog.ttft_ms).where(
                GatewayLog.created_at >= since,
                GatewayLog.created_at <= now,
            )
            if tenant_id:
                stmt = stmt.where(GatewayLog.user_id == tenant_id)
            rows = (await self.session.execute(stmt)).all()
            buckets: list[list[float]] = [[] for _ in range(bucket_count)]
            for created_at, ttft_ms in rows:
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=UTC)
                latency = float(ttft_ms or 0)
                delta = (created_at - since).total_seconds()
                idx = int(min(bucket_count - 1, max(0, math.floor(delta / bucket_width))))
                buckets[idx].append(latency)

            timeline: list[PercentilePoint] = []
            cursor = since
            for i in range(bucket_count):
                p50 = self._percentile(buckets[i], 50) if buckets else 0.0
                p99 = self._percentile(buckets[i], 99) if buckets else 0.0
                label = bucket_label(cursor, bucket_fmt)
                timeline.append(PercentilePoint(time=label, p50=p50, p99=p99))
                cursor += timedelta(hours=1 if bucket_fmt == "%H" else 24)

        resp = PercentileTrendsResponse(timeline=timeline)
        await cache.set(cache_key, resp, ttl=60)
        return resp

    # -------- Model Cost --------
    async def get_model_cost_breakdown(
        self,
        tenant_id: str | None,
        time_range: str,
    ) -> ModelCostBreakdownResponse:
        cache_key = CacheKeys.monitoring_model_cost(tenant_id, time_range)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        since = self._window_start(now, time_range)

        stmt = select(
            GatewayLog.model,
            func.sum(GatewayLog.cost_user),
        ).where(
            GatewayLog.created_at >= since,
            GatewayLog.created_at <= now,
        )
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        stmt = stmt.group_by(GatewayLog.model).order_by(func.sum(GatewayLog.cost_user).desc())

        rows = (await self.session.execute(stmt)).all()
        total_cost = float(sum(r[1] or 0 for r in rows))
        models = []
        for model_name, cost_sum in rows:
            cost_val = float(cost_sum or 0)
            percentage = round((cost_val / total_cost) * 100, 2) if total_cost else 0.0
            models.append(ModelCostItem(name=model_name, cost=cost_val, percentage=percentage))

        resp = ModelCostBreakdownResponse(models=models)
        await cache.set(cache_key, resp, ttl=120)
        return resp

    # -------- Error Distribution --------
    async def get_error_distribution(
        self,
        tenant_id: str | None,
        time_range: str,
        model: str | None = None,
    ) -> ErrorDistributionResponse:
        cache_key = CacheKeys.monitoring_error_distribution(tenant_id, time_range, model)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        since = self._window_start(now, time_range)

        stmt = select(GatewayLog.status_code, func.count()).where(
            GatewayLog.created_at >= since,
            GatewayLog.created_at <= now,
        )
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        if model:
            stmt = stmt.where(GatewayLog.model == model)
        stmt = stmt.group_by(GatewayLog.status_code)

        rows = (await self.session.execute(stmt)).all()
        counters = {"4xx": 0, "5xx": 0, "429": 0, "others": 0}
        for status_code, cnt in rows:
            if status_code == 429:
                counters["429"] += cnt
            elif 400 <= status_code < 500:
                counters["4xx"] += cnt
            elif status_code >= 500:
                counters["5xx"] += cnt
            else:
                counters["others"] += cnt

        categories = [
            ErrorCategoryItem(category="4xx", label="Client Errors", count=counters["4xx"], color="#fbbf24"),
            ErrorCategoryItem(category="5xx", label="Server Errors", count=counters["5xx"], color="#f87171"),
            ErrorCategoryItem(category="429", label="Rate Limit", count=counters["429"], color="#60a5fa"),
            ErrorCategoryItem(category="others", label="Others", count=counters["others"], color="#a78bfa"),
        ]

        resp = ErrorDistributionResponse(categories=categories)
        await cache.set(cache_key, resp, ttl=60)
        return resp

    # -------- Key Activity --------
    async def get_key_activity_ranking(
        self,
        tenant_id: str | None,
        time_range: str,
        limit: int,
    ) -> KeyActivityRankingResponse:
        cache_key = CacheKeys.monitoring_key_ranking(tenant_id, time_range, limit)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        since = self._window_start(now, time_range)
        window_minutes = max(1, (now - since).total_seconds() / 60)

        # 优先按 api_key_id 聚合；如缺失则回退 user_id（兼容历史数据）
        stmt = select(
            GatewayLog.api_key_id,
            func.count(),
        ).where(
            GatewayLog.created_at >= since,
            GatewayLog.created_at <= now,
        )
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        stmt = stmt.group_by(GatewayLog.api_key_id).order_by(func.count().desc()).limit(limit)

        rows = (await self.session.execute(stmt)).all()
        keys: list[KeyActivityItem] = []
        for api_key_id, cnt in rows:
            # 兼容历史记录：如果 api_key_id 为空，跳过（无法辨识具体 Key）
            if not api_key_id:
                continue
            rpm = round(float(cnt) / window_minutes, 2)

            # 趋势：与上一窗口对比
            prev_start = since - (now - since)
            prev_stmt = select(func.count()).where(
                GatewayLog.created_at >= prev_start,
                GatewayLog.created_at < since,
                GatewayLog.api_key_id == api_key_id,
            )
            prev_cnt = (await self.session.execute(prev_stmt)).scalar() or 0
            trend = round(((cnt - prev_cnt) / prev_cnt) * 100, 2) if prev_cnt else 0.0

            uid_str = str(api_key_id)
            masked = f"sk-***{uid_str[-4:]}"
            keys.append(
                KeyActivityItem(
                    id=uid_str,
                    name="API Key",
                    masked_key=masked,
                    rpm=rpm,
                    trend=trend,
                )
            )

        resp = KeyActivityRankingResponse(keys=keys)
        await cache.set(cache_key, resp, ttl=60)
        return resp

    # -------- Helpers --------
    def _window_start(self, now, time_range: str):
        match time_range:
            case "7d":
                return now - timedelta(days=7)
            case "30d":
                return now - timedelta(days=30)
            case _:
                return now - timedelta(hours=24)

    def _bucket_params(self, time_range: str):
        if time_range == "7d":
            return "%Y-%m-%d", 7, lambda dt, _: dt.strftime("%Y-%m-%d")
        if time_range == "30d":
            return "%Y-%m-%d", 30, lambda dt, _: dt.strftime("%Y-%m-%d")
        return "%H", 24, lambda dt, fmt: dt.strftime("%H:00")

    def _time_bucket(self, bucket_format: str):
        """与 Dashboard 对齐的时间桶表达式（支持 postgres 和 sqlite）。"""
        if self._dialect and self._dialect.name == "postgresql":
            if bucket_format == "%H":
                return func.to_char(GatewayLog.created_at, "HH24")
            if bucket_format == "%Y-%m-%d":
                return func.to_char(GatewayLog.created_at, "YYYY-MM-DD")
        return func.strftime(bucket_format, GatewayLog.created_at)

    @staticmethod
    def _percentile(data: Iterable[float], percentile: float) -> float:
        arr = sorted(data)
        if not arr:
            return 0.0
        k = (len(arr) - 1) * (percentile / 100)
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return float(arr[int(k)])
        d0 = arr[f] * (c - k)
        d1 = arr[c] * (k - f)
        return float(d0 + d1)
