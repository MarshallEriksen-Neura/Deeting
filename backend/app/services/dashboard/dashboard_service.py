from __future__ import annotations

import math
from datetime import UTC, timedelta
from decimal import Decimal
from typing import Iterable

from sqlalchemy import func, select, cast, Float, String, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.logging import logger
from app.models.gateway_log import GatewayLog
from app.models.provider_instance import ProviderInstance
from app.repositories.gateway_log_repository import GatewayLogRepository
from app.repositories.quota_repository import QuotaRepository
from app.repositories.provider_instance_repository import ProviderInstanceRepository
from app.schemas.dashboard import (
    DashboardStatsResponse,
    FinancialStats,
    HealthStats,
    ProviderHealthItem,
    RecentErrorItem,
    SmartRouterStatsResponse,
    SpeedStats,
    TokenThroughputResponse,
    TokenTimelinePoint,
    TrafficStats,
)
from app.services.providers.health_monitor import HealthMonitorService
from app.utils.time_utils import Datetime


class DashboardService:
    """汇总 Dashboard 所需数据，带 Redis 缓存与降级。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.log_repo = GatewayLogRepository(session)
        self.quota_repo = QuotaRepository(session)
        self.provider_repo = ProviderInstanceRepository(session)
        self.health_svc = HealthMonitorService(cache.redis) if getattr(cache, "_redis", None) else None

    # -------- Stats --------
    async def get_stats(self, tenant_id: str | None) -> DashboardStatsResponse:
        cache_key = CacheKeys.dashboard_stats(tenant_id)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        start_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # 财务与配额
        quota = None
        monthly_spent = 0.0
        quota_used_percent = 0.0
        balance = 0.0
        try:
            quota = await self.quota_repo.get_or_create(tenant_id) if tenant_id else None
            if quota:
                balance = float(quota.balance)
                monthly_total = quota.monthly_quota
                monthly_used = quota.monthly_used
                quota_used_percent = round((monthly_used / monthly_total) * 100, 2) if monthly_total else 0.0
        except Exception as exc:
            logger.warning(f"dashboard_quota_fallback tenant={tenant_id} err={exc}")

        # 月花费 = cost_user 当月总和
        monthly_spent = await self._sum_cost(start_month, now, tenant_id)

        # 当日流量/趋势
        today_requests, hourly_trend = await self._today_requests(start_day, now, tenant_id)
        trend_percent = await self._trend_vs_yesterday(start_day, tenant_id)

        # TTFT & 成功率（近 24h）
        avg_ttft, success_rate, total_req, success_req = await self._speed_and_health(now, tenant_id)

        resp = DashboardStatsResponse(
            financial=FinancialStats(
                monthly_spent=monthly_spent,
                balance=balance,
                quota_used_percent=quota_used_percent,
                estimated_month_end=None,
            ),
            traffic=TrafficStats(
                today_requests=today_requests,
                hourly_trend=hourly_trend,
                trend_percent=trend_percent,
            ),
            speed=SpeedStats(avg_ttft=avg_ttft, trend_percent=None),
            health=HealthStats(
                success_rate=success_rate,
                total_requests=total_req,
                successful_requests=success_req,
            ),
        )

        await cache.set(cache_key, resp, ttl=30)
        return resp

    async def _sum_cost(self, start, end, tenant_id: str | None) -> float:
        stmt = select(func.sum(GatewayLog.cost_user)).where(GatewayLog.created_at >= start, GatewayLog.created_at <= end)
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        result = await self.session.execute(stmt)
        val = result.scalar() or 0
        return float(val)

    def _time_bucket(self, bucket_format: str):
        """Return a DB-specific time bucket expression for created_at."""
        dialect = self.session.bind.dialect.name if getattr(self.session, "bind", None) else None
        if dialect == "postgresql":
            if bucket_format == "%H":
                return func.to_char(GatewayLog.created_at, "HH24")
            if bucket_format == "%Y-%m-%d":
                return func.to_char(GatewayLog.created_at, "YYYY-MM-DD")
        # default: sqlite (tests) / fallback
        return func.strftime(bucket_format, GatewayLog.created_at)

    async def _today_requests(self, start_day, now, tenant_id: str | None):
        bucket = self._time_bucket("%H")
        stmt = select(bucket, func.count())
        stmt = stmt.where(GatewayLog.created_at >= start_day, GatewayLog.created_at <= now)
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        stmt = stmt.group_by(bucket)
        result = await self.session.execute(stmt)
        rows = result.all()
        # 构造 24 长度数组
        buckets = [0] * 24
        total = 0
        for hour_str, cnt in rows:
            idx = int(hour_str)
            buckets[idx] = cnt
            total += cnt
        return total, buckets

    async def _trend_vs_yesterday(self, start_day, tenant_id: str | None):
        yesterday_start = start_day - timedelta(days=1)
        yesterday_end = start_day - timedelta(seconds=1)
        today_total, _ = await self._today_requests(start_day, start_day + timedelta(hours=23, minutes=59, seconds=59), tenant_id)
        y_total, _ = await self._today_requests(yesterday_start, yesterday_end, tenant_id)
        if y_total == 0:
            return None
        return round(((today_total - y_total) / y_total) * 100, 2)

    async def _speed_and_health(self, now, tenant_id: str | None):
        since = now - timedelta(hours=24)
        stmt = select(
            func.avg(GatewayLog.ttft_ms),
            func.count(),
            func.sum(case((GatewayLog.status_code < 400, 1), else_=0)),
        ).where(GatewayLog.created_at >= since)
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        result = await self.session.execute(stmt)
        avg_ttft, total_req, success_req = result.one()
        avg_ttft = float(avg_ttft or 0)
        total_req = int(total_req or 0)
        success_req = int(success_req or 0)
        success_rate = round((success_req / total_req) * 100, 2) if total_req else 0.0
        return avg_ttft, success_rate, total_req, success_req

    # -------- Throughput --------
    async def get_token_throughput(self, tenant_id: str | None, period: str) -> TokenThroughputResponse:
        cache_key = CacheKeys.dashboard_throughput(tenant_id, period)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        if period == "24h":
            since = now - timedelta(hours=24)
            bucket_format = "%H"  # hourly
            bucket_count = 24
        elif period == "7d":
            since = now - timedelta(days=7)
            bucket_format = "%Y-%m-%d"
            bucket_count = 7
        else:
            since = now - timedelta(days=30)
            bucket_format = "%Y-%m-%d"
            bucket_count = 30

        bucket_expr = self._time_bucket(bucket_format)
        stmt = select(
            bucket_expr,
            func.sum(GatewayLog.input_tokens),
            func.sum(GatewayLog.output_tokens),
        ).where(GatewayLog.created_at >= since)
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        stmt = stmt.group_by(bucket_expr).order_by(bucket_expr)
        rows = await self.session.execute(stmt)
        rows = rows.all()

        timeline: list[TokenTimelinePoint] = []
        total_in = total_out = 0
        # 构造时间桶映射
        bucket_map = {key: (i_tokens or 0, o_tokens or 0) for key, i_tokens, o_tokens in rows}

        # 生成连续时间轴
        cursor = since
        for _ in range(bucket_count):
            if bucket_format == "%H":
                label = cursor.strftime("%H:00")
                cursor += timedelta(hours=1)
            else:
                label = cursor.strftime("%Y-%m-%d")
                cursor += timedelta(days=1)
            key = label if bucket_format != "%H" else label[:2]
            input_tokens, output_tokens = bucket_map.get(key, (0, 0))
            timeline.append(
                TokenTimelinePoint(time=label, input_tokens=input_tokens, output_tokens=output_tokens)
            )
            total_in += input_tokens
            total_out += output_tokens

        ratio = round((total_out / total_in), 4) if total_in else 0.0

        resp = TokenThroughputResponse(
            timeline=timeline,
            total_input=total_in,
            total_output=total_out,
            ratio=ratio,
        )
        await cache.set(cache_key, resp, ttl=60)
        return resp

    # -------- Smart Router --------
    async def get_smart_router_stats(self, tenant_id: str | None) -> SmartRouterStatsResponse:
        cache_key = CacheKeys.dashboard_smart_router(tenant_id)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        since = now - timedelta(hours=24)
        base_stmt = select(GatewayLog)
        if tenant_id:
            base_stmt = base_stmt.where(GatewayLog.user_id == tenant_id)
        base_stmt = base_stmt.where(GatewayLog.created_at >= since)

        base_subq = base_stmt.subquery()

        # 缓存命中率
        stmt_hit = select(func.count()).select_from(base_subq).where(base_subq.c.is_cached == True)  # noqa: E712
        hit = (await self.session.execute(stmt_hit)).scalar() or 0
        total = (await self.session.execute(select(func.count()).select_from(base_subq))).scalar() or 0
        cache_hit_rate = round((hit / total) * 100, 2) if total else 0.0

        # 成本节省
        stmt_cost = select(func.sum(base_subq.c.cost_user - base_subq.c.cost_upstream)).select_from(base_subq)
        cost_savings = float((await self.session.execute(stmt_cost)).scalar() or 0.0)
        cost_savings = max(cost_savings, 0.0)

        # 拦截请求（error_code 风控/限流）
        blocked_stmt = select(func.count()).select_from(base_subq).where(
            base_subq.c.error_code.in_(["RATE_LIMITED", "BLOCKED", "SECURITY_DENY"])
        )
        requests_blocked = int((await self.session.execute(blocked_stmt)).scalar() or 0)

        # 平均加速：使用 meta.routing.affinity_saved_tokens_est 估算
        dialect = self.session.bind.dialect.name if getattr(self.session, "bind", None) else None
        meta_expr = base_subq.c.meta["routing"]["affinity_saved_tokens_est"]
        if dialect == "postgresql":
            meta_text = cast(meta_expr, String)
            is_numeric = meta_text.op("~")(r"^-?\d+(\.\d+)?$")
            routing_saved_tokens = case((is_numeric, cast(meta_text, Float)), else_=None)
        else:
            routing_saved_tokens = cast(cast(meta_expr, String), Float)
        stmt_speed = select(func.avg(routing_saved_tokens)).select_from(base_subq)
        saved_tokens = float((await self.session.execute(stmt_speed)).scalar() or 0.0)
        avg_speedup = round(saved_tokens * 3, 2) if saved_tokens > 0 else 0.0  # 约 3ms/Token 估算

        resp = SmartRouterStatsResponse(
            cache_hit_rate=cache_hit_rate,
            cost_savings=cost_savings,
            requests_blocked=requests_blocked,
            avg_speedup=avg_speedup,
        )
        await cache.set(cache_key, resp, ttl=30)
        return resp

    # -------- Provider Health --------
    async def get_provider_health(self, tenant_id: str | None) -> list[ProviderHealthItem]:
        # 复用 provider_instance 列表和 health_monitor redis 结果，不另外缓存（已在 repo 层缓存 instance 列表）
        instances = await self.provider_repo.get_available_instances(user_id=tenant_id, include_public=True)
        items: list[ProviderHealthItem] = []
        for inst in instances:
            health = {"status": "unknown", "latency": 0}
            if self.health_svc:
                try:
                    health = await self.health_svc.get_health_status(str(inst.id)) or health
                    spark = await self.health_svc.get_sparkline(str(inst.id))
                except Exception:
                    spark = []
            else:
                spark = []
            items.append(
                ProviderHealthItem(
                    id=str(inst.id),
                    name=inst.name,
                    status=health.get("status", "unknown"),
                    priority=inst.priority,
                    latency=int(health.get("latency", 0) or 0),
                    sparkline=spark or None,
                )
            )
        return items

    # -------- Recent Errors --------
    async def get_recent_errors(self, tenant_id: str | None, limit: int = 10) -> list[RecentErrorItem]:
        cache_key = CacheKeys.dashboard_errors(tenant_id, limit)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        since = Datetime.now() - timedelta(hours=24)
        stmt = select(GatewayLog).where(GatewayLog.created_at >= since)
        if tenant_id:
            stmt = stmt.where(GatewayLog.user_id == tenant_id)
        stmt = stmt.where((GatewayLog.status_code >= 400) | (GatewayLog.error_code.isnot(None)))
        stmt = stmt.order_by(GatewayLog.created_at.desc())
        stmt = stmt.limit(limit)
        rows = await self.session.execute(stmt)
        logs: Iterable[GatewayLog] = rows.scalars().all()

        items = [
            RecentErrorItem(
                id=str(log.id),
                timestamp=log.created_at,
                status_code=log.status_code,
                model=log.model,
                error_message=(log.error_code or "") or "",
                error_code=log.error_code,
            )
            for log in logs
        ]
        await cache.set(cache_key, items, ttl=20)
        return items
