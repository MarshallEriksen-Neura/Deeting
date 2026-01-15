from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.schemas.credits import (
    CreditsBalanceResponse,
    CreditsConsumptionResponse,
    CreditsModelUsageResponse,
    CreditsTransactionListResponse,
)
from app.services.credits import CreditsService

router = APIRouter(prefix="/credits", tags=["Credits"])


def get_credits_service(db: AsyncSession = Depends(get_db)) -> CreditsService:
    return CreditsService(db)


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
    return await svc.get_consumption(str(current_user.id) if current_user else None, days)


@router.get("/model-usage", response_model=CreditsModelUsageResponse)
async def get_model_usage(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsModelUsageResponse:
    return await svc.get_model_usage(str(current_user.id) if current_user else None, days)


@router.get("/transactions", response_model=CreditsTransactionListResponse)
async def get_transactions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsTransactionListResponse:
    return await svc.list_transactions(str(current_user.id) if current_user else None, limit, offset)
