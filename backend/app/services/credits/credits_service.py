from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Dict, Iterable, List, Tuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.models.billing import BillingTransaction, TransactionStatus, TransactionType
from app.repositories.billing_repository import BillingRepository
from app.repositories.quota_repository import QuotaRepository
from app.schemas.credits import (
    CreditsBalanceResponse,
    CreditsConsumptionPoint,
    CreditsConsumptionResponse,
    CreditsModelUsageItem,
    CreditsModelUsageResponse,
    CreditsTransactionItem,
    CreditsTransactionListResponse,
)
from app.utils.time_utils import Datetime


class CreditsService:
    """积分/计费数据聚合服务。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.quota_repo = QuotaRepository(session)
        self.billing_repo = BillingRepository(session)
        self._dialect = getattr(getattr(session, "bind", None), "dialect", None)

    async def get_balance(self, tenant_id: str | None) -> CreditsBalanceResponse:
        if not tenant_id:
            return CreditsBalanceResponse(balance=0, monthly_spent=0, used_percent=0)

        cache_key = CacheKeys.credits_balance(tenant_id)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        quota = await self.quota_repo.get_or_create(tenant_id)
        balance = float(quota.balance)

        now = Datetime.now()
        start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        monthly_spent = await self._sum_amount(start_month, now, tenant_id)

        denominator = monthly_spent + balance
        used_percent = round((monthly_spent / denominator) * 100, 2) if denominator > 0 else 0.0

        resp = CreditsBalanceResponse(
            balance=balance,
            monthly_spent=monthly_spent,
            used_percent=used_percent,
        )
        await cache.set(cache_key, resp, ttl=30)
        return resp

    async def get_consumption(self, tenant_id: str | None, days: int) -> CreditsConsumptionResponse:
        days = max(1, min(days, 90))
        if not tenant_id:
            return self._empty_consumption(days)

        cache_key = CacheKeys.credits_consumption(tenant_id, days)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        start_date = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

        bucket_expr = self._date_bucket_expr()
        model_expr = func.coalesce(BillingTransaction.model, "unknown")
        total_tokens = BillingTransaction.input_tokens + BillingTransaction.output_tokens

        stmt = (
            select(
                bucket_expr.label("bucket"),
                model_expr.label("model"),
                func.sum(total_tokens).label("tokens"),
            )
            .where(
                BillingTransaction.created_at >= start_date,
                BillingTransaction.created_at <= now,
                BillingTransaction.tenant_id == tenant_id,
                BillingTransaction.status == TransactionStatus.COMMITTED,
                BillingTransaction.type == TransactionType.DEDUCT,
            )
            .group_by(bucket_expr, model_expr)
        )

        rows = (await self.session.execute(stmt)).all()
        models = sorted({row.model for row in rows})
        tokens_map: Dict[Tuple[str, str], int] = {
            (row.bucket, row.model): int(row.tokens or 0) for row in rows
        }

        timeline = []
        for day in self._iter_days(start_date, days):
            day_key = day.strftime("%Y-%m-%d")
            tokens_by_model = {model: tokens_map.get((day_key, model), 0) for model in models}
            timeline.append(CreditsConsumptionPoint(date=day_key, tokens_by_model=tokens_by_model))

        resp = CreditsConsumptionResponse(
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=now.strftime("%Y-%m-%d"),
            days=days,
            models=models,
            timeline=timeline,
        )
        await cache.set(cache_key, resp, ttl=60)
        return resp

    async def get_model_usage(self, tenant_id: str | None, days: int) -> CreditsModelUsageResponse:
        days = max(1, min(days, 90))
        if not tenant_id:
            return CreditsModelUsageResponse(total_tokens=0, models=[])

        cache_key = CacheKeys.credits_model_usage(tenant_id, days)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        now = Datetime.now()
        start_date = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        model_expr = func.coalesce(BillingTransaction.model, "unknown")
        total_tokens = BillingTransaction.input_tokens + BillingTransaction.output_tokens

        stmt = (
            select(
                model_expr.label("model"),
                func.sum(total_tokens).label("tokens"),
            )
            .where(
                BillingTransaction.created_at >= start_date,
                BillingTransaction.created_at <= now,
                BillingTransaction.tenant_id == tenant_id,
                BillingTransaction.status == TransactionStatus.COMMITTED,
                BillingTransaction.type == TransactionType.DEDUCT,
            )
            .group_by(model_expr)
            .order_by(func.sum(total_tokens).desc())
        )
        rows = (await self.session.execute(stmt)).all()
        total = int(sum((row.tokens or 0) for row in rows))
        items: List[CreditsModelUsageItem] = []
        for row in rows:
            tokens = int(row.tokens or 0)
            percentage = round((tokens / total) * 100, 2) if total else 0.0
            items.append(CreditsModelUsageItem(model=row.model, tokens=tokens, percentage=percentage))

        resp = CreditsModelUsageResponse(total_tokens=total, models=items)
        await cache.set(cache_key, resp, ttl=120)
        return resp

    async def list_transactions(
        self,
        tenant_id: str | None,
        limit: int = 20,
        offset: int = 0,
    ) -> CreditsTransactionListResponse:
        limit = max(1, min(limit, 100))
        offset = max(0, offset)
        if not tenant_id:
            return CreditsTransactionListResponse(items=[], next_offset=None)

        transactions = await self.billing_repo.list_transactions(
            tenant_id=tenant_id,
            limit=limit + 1,
            offset=offset,
            status=TransactionStatus.COMMITTED,
            type_filter=TransactionType.DEDUCT,
        )

        has_more = len(transactions) > limit
        if has_more:
            transactions = transactions[:limit]

        items = [
            CreditsTransactionItem(
                id=str(tx.id),
                trace_id=tx.trace_id,
                model=tx.model,
                status="success",
                amount=float(tx.amount),
                input_tokens=int(tx.input_tokens or 0),
                output_tokens=int(tx.output_tokens or 0),
                total_tokens=int((tx.input_tokens or 0) + (tx.output_tokens or 0)),
                created_at=tx.created_at,
            )
            for tx in transactions
        ]

        next_offset = offset + limit if has_more else None
        return CreditsTransactionListResponse(items=items, next_offset=next_offset)

    def _date_bucket_expr(self):
        if self._dialect and self._dialect.name == "postgresql":
            return func.to_char(BillingTransaction.created_at, "YYYY-MM-DD")
        return func.strftime("%Y-%m-%d", BillingTransaction.created_at)

    @staticmethod
    def _iter_days(start_date, days: int) -> Iterable:
        cursor = start_date
        for _ in range(days):
            yield cursor
            cursor += timedelta(days=1)

    @staticmethod
    def _empty_consumption(days: int) -> CreditsConsumptionResponse:
        now = Datetime.now()
        start_date = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        timeline = [
            CreditsConsumptionPoint(date=(start_date + timedelta(days=i)).strftime("%Y-%m-%d"), tokens_by_model={})
            for i in range(days)
        ]
        return CreditsConsumptionResponse(
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=now.strftime("%Y-%m-%d"),
            days=days,
            models=[],
            timeline=timeline,
        )

    async def _sum_amount(self, start, end, tenant_id: str) -> float:
        stmt = (
            select(func.sum(BillingTransaction.amount))
            .where(
                BillingTransaction.created_at >= start,
                BillingTransaction.created_at <= end,
                BillingTransaction.tenant_id == tenant_id,
                BillingTransaction.status == TransactionStatus.COMMITTED,
                BillingTransaction.type == TransactionType.DEDUCT,
            )
        )
        result = await self.session.execute(stmt)
        value = result.scalar() or Decimal("0")
        return float(value)
