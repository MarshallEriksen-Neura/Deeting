from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user
from app.models import User
from app.repositories import ProviderModelRepository, SystemSettingRepository
from app.schemas import SystemEmbeddingSettingDTO
from app.services.system_settings_service import SystemSettingsService

router = APIRouter(prefix="/settings", tags=["Settings"])


def get_system_settings_service(
    db: AsyncSession = Depends(get_db),
) -> SystemSettingsService:
    return SystemSettingsService(
        SystemSettingRepository(db),
        ProviderModelRepository(db),
    )


@router.get("/embedding", response_model=SystemEmbeddingSettingDTO)
async def get_system_embedding_setting(
    _user: User = Depends(get_current_active_user),
    service: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemEmbeddingSettingDTO:
    model_name = await service.get_embedding_model()
    return SystemEmbeddingSettingDTO(model_name=model_name)
