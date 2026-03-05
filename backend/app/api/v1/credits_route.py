from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.repositories import ProviderModelRepository, SystemSettingRepository
from app.schemas.credits import (
    CreditsBalanceResponse,
    CreditsConsumptionResponse,
    CreditsRechargePolicyResponse,
    CreditsRechargeRequest,
    CreditsRechargeResponse,
    CreditsModelUsageResponse,
    CreditsTransactionListResponse,
)
from app.services.credits import CreditsService
from app.services.system import SystemSettingsService

router = APIRouter(prefix="/credits", tags=["Credits"])


def get_credits_service(db: AsyncSession = Depends(get_db)) -> CreditsService:
    return CreditsService(db)


def get_system_settings_service(
    db: AsyncSession = Depends(get_db),
) -> SystemSettingsService:
    return SystemSettingsService(
        SystemSettingRepository(db),
        ProviderModelRepository(db),
    )


@router.get("/balance", response_model=CreditsBalanceResponse)
async def get_balance(
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsBalanceResponse:
    return await svc.get_balance(str(current_user.id) if current_user else None)


@router.get("/consumption", response_model=CreditsConsumptionResponse)
async def get_consumption(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsConsumptionResponse:
    return await svc.get_consumption(
        str(current_user.id) if current_user else None, days
    )


@router.get("/model-usage", response_model=CreditsModelUsageResponse)
async def get_model_usage(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsModelUsageResponse:
    return await svc.get_model_usage(
        str(current_user.id) if current_user else None, days
    )


@router.get("/transactions", response_model=CreditsTransactionListResponse)
async def get_transactions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsTransactionListResponse:
    return await svc.list_transactions(
        str(current_user.id) if current_user else None, limit, offset
    )


@router.get("/recharge-policy", response_model=CreditsRechargePolicyResponse)
async def get_recharge_policy(
    _current_user: User = Depends(get_current_user),
    system_settings_service: SystemSettingsService = Depends(get_system_settings_service),
) -> CreditsRechargePolicyResponse:
    policy = await system_settings_service.get_recharge_policy()
    return CreditsRechargePolicyResponse(**policy)


@router.post("/recharge", response_model=CreditsRechargeResponse)
async def recharge_credits(
    payload: CreditsRechargeRequest,
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
    system_settings_service: SystemSettingsService = Depends(get_system_settings_service),
) -> CreditsRechargeResponse:
    policy = await system_settings_service.get_recharge_policy()
    try:
        return await svc.recharge(
            tenant_id=str(current_user.id) if current_user else None,
            amount=payload.amount,
            credit_per_unit=float(policy["credit_per_unit"]),
            currency=str(policy["currency"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
