from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.schemas.admin_ops import (
    BillingSummaryResponse,
    BillingTransactionAdminItem,
    BillingTransactionAdminListResponse,
    TenantQuotaAdjustRequest,
    TenantQuotaAdminItem,
    TenantQuotaAdminListResponse,
    TenantQuotaUpdateRequest,
)
from app.services.admin import BillingAdminService
from app.utils.time_utils import Datetime

router = APIRouter(prefix="/admin", tags=["Admin - Billing"])


def get_service(db: AsyncSession = Depends(get_db)) -> BillingAdminService:
    return BillingAdminService(db)


@router.get("/quotas", response_model=TenantQuotaAdminListResponse)
async def list_quotas(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    tenant_id: UUID | None = None,
    is_active: bool | None = None,
    _=Depends(get_current_superuser),
    service: BillingAdminService = Depends(get_service),
) -> TenantQuotaAdminListResponse:
    return await service.list_quotas(
        skip=skip,
        limit=limit,
        tenant_id=tenant_id,
        is_active=is_active,
    )


@router.get("/quotas/{tenant_id}", response_model=TenantQuotaAdminItem)
async def get_quota(
    tenant_id: UUID,
    _=Depends(get_current_superuser),
    service: BillingAdminService = Depends(get_service),
) -> TenantQuotaAdminItem:
    return await service.get_quota(tenant_id)


@router.patch("/quotas/{tenant_id}", response_model=TenantQuotaAdminItem)
async def patch_quota(
    tenant_id: UUID,
    payload: TenantQuotaUpdateRequest,
    _=Depends(get_current_superuser),
    service: BillingAdminService = Depends(get_service),
) -> TenantQuotaAdminItem:
    return await service.update_quota(
        tenant_id=tenant_id,
        credit_limit=payload.credit_limit,
        daily_quota=payload.daily_quota,
        monthly_quota=payload.monthly_quota,
        rpm_limit=payload.rpm_limit,
        tpm_limit=payload.tpm_limit,
        token_quota=payload.token_quota,
        is_active=payload.is_active,
    )


@router.post(
    "/quotas/{tenant_id}/adjust",
    response_model=BillingTransactionAdminItem,
)
async def adjust_quota(
    tenant_id: UUID,
    payload: TenantQuotaAdjustRequest,
    _=Depends(get_current_superuser),
    service: BillingAdminService = Depends(get_service),
) -> BillingTransactionAdminItem:
    return await service.adjust_balance(
        tenant_id=tenant_id,
        amount=payload.amount,
        reason=payload.reason,
    )


@router.get(
    "/billing/transactions",
    response_model=BillingTransactionAdminListResponse,
)
async def list_billing_transactions(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    tenant_id: UUID | None = None,
    type_filter: str | None = Query(
        default=None,
        alias="type",
        pattern="^(deduct|recharge|refund|adjust)$",
    ),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        pattern="^(pending|committed|reversed)$",
    ),
    model: str | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    _=Depends(get_current_superuser),
    service: BillingAdminService = Depends(get_service),
) -> BillingTransactionAdminListResponse:
    return await service.list_transactions(
        skip=skip,
        limit=limit,
        tenant_id=tenant_id,
        type_filter=type_filter,
        status_filter=status_filter,
        model=model,
        start_time=start_time,
        end_time=end_time,
    )


@router.get("/billing/summary", response_model=BillingSummaryResponse)
async def get_billing_summary(
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    _=Depends(get_current_superuser),
    service: BillingAdminService = Depends(get_service),
) -> BillingSummaryResponse:
    now = Datetime.now()
    start = start_time or now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = end_time or now
    return await service.get_summary(start_time=start, end_time=end)


@router.get(
    "/billing/transactions/{transaction_id}",
    response_model=BillingTransactionAdminItem,
)
async def get_billing_transaction(
    transaction_id: UUID,
    _=Depends(get_current_superuser),
    service: BillingAdminService = Depends(get_service),
) -> BillingTransactionAdminItem:
    return await service.get_transaction(transaction_id)
