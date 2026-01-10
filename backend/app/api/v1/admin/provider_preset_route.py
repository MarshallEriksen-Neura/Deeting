from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.provider_preset import ProviderPreset
from app.schemas.provider_preset import ProviderPresetDTO, ProviderWish
from app.deps.auth import get_current_user
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.core.logging import logger

router = APIRouter(prefix="/admin/provider-presets", tags=["ProviderPresets"])

@router.get("", response_model=List[ProviderPresetDTO])
async def list_presets(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    repo = ProviderPresetRepository(db)
    # Market only shows system/curated presets.
    presets = await repo.get_active_presets()
    return presets

@router.post("/wishes", status_code=status.HTTP_202_ACCEPTED)
async def wish_provider(
    payload: ProviderWish,
    user=Depends(get_current_user),
):
    """
    Submit a wish for a new provider.
    Currently just logs the wish, but can be extended to store in DB.
    """
    logger.info(
        "provider_wish_submitted",
        extra={
            "user_id": str(user.id),
            "provider_name": payload.provider_name,
            "url": payload.url,
            "description": payload.description
        }
    )
    return {"message": "Wish received"}
