from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing import (
    BillingTransaction,
    TenantQuota,
    TransactionStatus,
    TransactionType,
)
from app.models.gateway_log import GatewayLog
from app.repositories.quota_repository import QuotaRepository
from app.schemas.admin_ops import (
    BillingSummaryResponse,
    BillingTransactionAdminItem,
    BillingTransactionAdminListResponse,
    TenantQuotaAdminItem,
    TenantQuotaAdminListResponse,
)


class BillingAdminService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.quota_repo = QuotaRepository(db)

    async def list_quotas(
        self,
        *,
        skip: int,
        limit: int,
        tenant_id: UUID | None = None,
        is_active: bool | None = None,
    ) -> TenantQuotaAdminListResponse:
        conditions = []
        if tenant_id:
            conditions.append(TenantQuota.tenant_id == tenant_id)
        if is_active is not None:
            conditions.append(TenantQuota.is_active == is_active)

        stmt = select(TenantQuota)
        count_stmt = select(func.count()).select_from(TenantQuota)
        if conditions:
            stmt = stmt.where(*conditions)
            count_stmt = count_stmt.where(*conditions)

        stmt = (
            stmt.order_by(TenantQuota.updated_at.desc(), TenantQuota.id.desc())
            .offset(skip)
            .limit(limit)
        )

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)
        return TenantQuotaAdminListResponse(
            items=[self._quota_to_item(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def get_quota(self, tenant_id: UUID) -> TenantQuotaAdminItem:
        quota = await self._get_quota_or_404(tenant_id)
        return self._quota_to_item(quota)

    async def update_quota(
        self,
        *,
        tenant_id: UUID,
        credit_limit: float | None,
        daily_quota: int | None,
        monthly_quota: int | None,
        rpm_limit: int | None,
        tpm_limit: int | None,
        token_quota: int | None,
        is_active: bool | None,
    ) -> TenantQuotaAdminItem:
        await self._get_quota_or_404(tenant_id)

        updated = await self.quota_repo.update_limits(
            tenant_id=tenant_id,
            credit_limit=(
                Decimal(str(credit_limit)) if credit_limit is not None else None
            ),
            daily_quota=daily_quota,
            monthly_quota=monthly_quota,
            rpm_limit=rpm_limit,
            tpm_limit=tpm_limit,
            token_quota=token_quota,
        )

        if is_active is not None and updated.is_active != is_active:
            updated.is_active = is_active
            await self.db.commit()
            await self.db.refresh(updated)

        return self._quota_to_item(updated)

    async def adjust_balance(
        self,
        *,
        tenant_id: UUID,
        amount: float,
        reason: str | None,
    ) -> BillingTransactionAdminItem:
        quota = await self._get_quota_or_404(tenant_id)
        amount_decimal = Decimal(str(amount))

        before = quota.balance
        tx_type = (
            TransactionType.RECHARGE
            if amount_decimal >= 0
            else TransactionType.ADJUST
        )

        if amount_decimal >= 0:
            updated_quota = await self.quota_repo.add_balance(tenant_id, amount_decimal)
        else:
            updated_quota = await self.quota_repo.check_and_deduct(
                tenant_id=tenant_id,
                balance_amount=abs(amount_decimal),
                allow_negative=True,
            )

        tx = BillingTransaction(
            tenant_id=tenant_id,
            trace_id=f"admin-adjust-{uuid4().hex[:24]}",
            type=tx_type,
            status=TransactionStatus.COMMITTED,
            amount=abs(amount_decimal),
            input_tokens=0,
            output_tokens=0,
            input_price=Decimal("0"),
            output_price=Decimal("0"),
            balance_before=before,
            balance_after=updated_quota.balance,
            description=reason or "admin manual quota adjustment",
        )
        self.db.add(tx)
        await self.db.commit()
        await self.db.refresh(tx)
        return self._transaction_to_item(tx)

    async def list_transactions(
        self,
        *,
        skip: int,
        limit: int,
        tenant_id: UUID | None = None,
        type_filter: str | None = None,
        status_filter: str | None = None,
        model: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> BillingTransactionAdminListResponse:
        conditions = []
        if tenant_id:
            conditions.append(BillingTransaction.tenant_id == tenant_id)
        if type_filter:
            conditions.append(BillingTransaction.type == TransactionType(type_filter))
        if status_filter:
            conditions.append(
                BillingTransaction.status == TransactionStatus(status_filter)
            )
        if model:
            conditions.append(BillingTransaction.model == model)
        if start_time:
            conditions.append(BillingTransaction.created_at >= start_time)
        if end_time:
            conditions.append(BillingTransaction.created_at <= end_time)

        stmt = select(BillingTransaction)
        count_stmt = select(func.count()).select_from(BillingTransaction)
        if conditions:
            stmt = stmt.where(*conditions)
            count_stmt = count_stmt.where(*conditions)

        stmt = stmt.order_by(
            BillingTransaction.created_at.desc(), BillingTransaction.id.desc()
        ).offset(skip).limit(limit)

        rows = (await self.db.execute(stmt)).scalars().all()
        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        return BillingTransactionAdminListResponse(
            items=[self._transaction_to_item(row) for row in rows],
            total=total,
            skip=skip,
            limit=limit,
        )

    async def get_transaction(
        self, transaction_id: UUID
    ) -> BillingTransactionAdminItem:
        tx = await self.db.get(BillingTransaction, transaction_id)
        if not tx:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="billing transaction not found",
            )
        return self._transaction_to_item(tx)

    async def get_summary(
        self,
        *,
        start_time: datetime,
        end_time: datetime,
    ) -> BillingSummaryResponse:
        income_stmt = select(func.sum(BillingTransaction.amount)).where(
            BillingTransaction.created_at >= start_time,
            BillingTransaction.created_at <= end_time,
            BillingTransaction.status == TransactionStatus.COMMITTED,
            BillingTransaction.type.in_(
                [TransactionType.DEDUCT, TransactionType.RECHARGE]
            ),
        )
        refunds_stmt = select(func.sum(BillingTransaction.amount)).where(
            BillingTransaction.created_at >= start_time,
            BillingTransaction.created_at <= end_time,
            BillingTransaction.status == TransactionStatus.COMMITTED,
            BillingTransaction.type == TransactionType.REFUND,
        )
        cost_stmt = select(func.sum(GatewayLog.cost_upstream)).where(
            GatewayLog.created_at >= start_time,
            GatewayLog.created_at <= end_time,
        )
        count_stmt = select(func.count()).select_from(BillingTransaction).where(
            BillingTransaction.created_at >= start_time,
            BillingTransaction.created_at <= end_time,
            BillingTransaction.status == TransactionStatus.COMMITTED,
        )

        income = Decimal(str((await self.db.execute(income_stmt)).scalar() or 0))
        refunds = Decimal(str((await self.db.execute(refunds_stmt)).scalar() or 0))
        cost = Decimal(str((await self.db.execute(cost_stmt)).scalar() or 0))
        tx_count = int((await self.db.execute(count_stmt)).scalar() or 0)

        profit = income - refunds - cost
        return BillingSummaryResponse(
            start_time=start_time,
            end_time=end_time,
            income=float(income),
            refunds=float(refunds),
            cost=float(cost),
            profit=float(profit),
            transaction_count=tx_count,
        )

    async def _get_quota_or_404(self, tenant_id: UUID) -> TenantQuota:
        stmt = select(TenantQuota).where(TenantQuota.tenant_id == tenant_id)
        quota = (await self.db.execute(stmt)).scalars().first()
        if not quota:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="tenant quota not found",
            )
        return quota

    @staticmethod
    def _quota_to_item(quota: TenantQuota) -> TenantQuotaAdminItem:
        return TenantQuotaAdminItem(
            id=quota.id,
            tenant_id=quota.tenant_id,
            balance=float(quota.balance),
            credit_limit=float(quota.credit_limit),
            daily_quota=quota.daily_quota,
            daily_used=quota.daily_used,
            monthly_quota=quota.monthly_quota,
            monthly_used=quota.monthly_used,
            rpm_limit=quota.rpm_limit,
            tpm_limit=quota.tpm_limit,
            token_quota=quota.token_quota,
            token_used=quota.token_used,
            is_active=quota.is_active,
            created_at=quota.created_at,
            updated_at=quota.updated_at,
        )

    @staticmethod
    def _transaction_to_item(tx: BillingTransaction) -> BillingTransactionAdminItem:
        tx_type = (
            tx.type.value if isinstance(tx.type, TransactionType) else str(tx.type)
        )
        tx_status = (
            tx.status.value
            if isinstance(tx.status, TransactionStatus)
            else str(tx.status)
        )
        return BillingTransactionAdminItem(
            id=tx.id,
            tenant_id=tx.tenant_id,
            api_key_id=tx.api_key_id,
            trace_id=tx.trace_id,
            type=tx_type,
            status=tx_status,
            amount=float(tx.amount),
            input_tokens=int(tx.input_tokens or 0),
            output_tokens=int(tx.output_tokens or 0),
            model=tx.model,
            provider=tx.provider,
            balance_before=float(tx.balance_before),
            balance_after=float(tx.balance_after),
            description=tx.description,
            created_at=tx.created_at,
            updated_at=tx.updated_at,
        )
