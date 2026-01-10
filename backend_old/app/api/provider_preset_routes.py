from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.deps import get_db
from app.jwt_auth import require_jwt_token
from app.schemas import ProviderPresetListResponse, ProviderPresetResponse
from app.services.provider_preset_service import list_provider_presets

router = APIRouter(
    tags=["provider-presets"],
    dependencies=[Depends(require_jwt_token)],
)


@router.get("/provider-presets", response_model=ProviderPresetListResponse)
def list_provider_presets_endpoint(
    db: Session = Depends(get_db),
) -> ProviderPresetListResponse:
    presets = list_provider_presets(db)
    return ProviderPresetListResponse(
        items=[ProviderPresetResponse.model_validate(p) for p in presets],
        total=len(presets),
    )


__all__ = ["router"]
