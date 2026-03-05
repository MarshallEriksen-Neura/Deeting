from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.models import User
from app.repositories import ProviderModelRepository, SystemSettingRepository
from app.schemas import (
    SystemEmbeddingSettingDTO,
    SystemEmbeddingSettingUpdateRequest,
    SystemRechargePolicyDTO,
    SystemRechargePolicyUpdateRequest,
)
from app.services.system import SystemSettingsService

router = APIRouter(prefix="/admin/settings", tags=["Admin - Settings"])


def get_system_settings_service(
    db: AsyncSession = Depends(get_db),
) -> SystemSettingsService:
    return SystemSettingsService(
        SystemSettingRepository(db),
        ProviderModelRepository(db),
    )


@router.get("/embedding", response_model=SystemEmbeddingSettingDTO)
async def get_system_embedding_setting(
    _user: User = Depends(get_current_superuser),
    service: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemEmbeddingSettingDTO:
    model_name = await service.get_embedding_model()
    return SystemEmbeddingSettingDTO(model_name=model_name)


@router.patch("/embedding", response_model=SystemEmbeddingSettingDTO)
async def update_system_embedding_setting(
    payload: SystemEmbeddingSettingUpdateRequest,
    _user: User = Depends(get_current_superuser),
    service: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemEmbeddingSettingDTO:
    try:
        model_name = await service.set_embedding_model(payload.model_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return SystemEmbeddingSettingDTO(model_name=model_name)


@router.get("/recharge-policy", response_model=SystemRechargePolicyDTO)
async def get_recharge_policy(
    _user: User = Depends(get_current_superuser),
    service: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemRechargePolicyDTO:
    policy = await service.get_recharge_policy()
    return SystemRechargePolicyDTO(**policy)


@router.patch("/recharge-policy", response_model=SystemRechargePolicyDTO)
async def update_recharge_policy(
    payload: SystemRechargePolicyUpdateRequest,
    _user: User = Depends(get_current_superuser),
    service: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemRechargePolicyDTO:
    try:
        policy = await service.set_recharge_policy(
            credit_per_unit=payload.credit_per_unit,
            currency=payload.currency,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return SystemRechargePolicyDTO(**policy)
