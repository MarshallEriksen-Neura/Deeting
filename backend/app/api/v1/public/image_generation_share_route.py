from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi_pagination.cursor import CursorPage, CursorParams
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.image_generation import ImageGenerationShareDetail, ImageGenerationShareItem
from app.services.image_generation.share_service import ImageGenerationShareService

router = APIRouter(tags=["Public Image Share"])


@router.get(
    "/public/images/shares",
    response_model=CursorPage[ImageGenerationShareItem],
)
async def list_public_image_shares(
    request: Request,
    params: CursorParams = Depends(),
    db: AsyncSession = Depends(get_db),
) -> CursorPage[ImageGenerationShareItem]:
    service = ImageGenerationShareService(db)
    base_url = str(request.base_url).rstrip("/") if request else None
    return await service.list_public_shares(params=params, base_url=base_url)


@router.get(
    "/public/images/shares/{share_id}",
    response_model=ImageGenerationShareDetail,
)
async def get_public_image_share(
    share_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ImageGenerationShareDetail:
    try:
        share_uuid = uuid.UUID(share_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid share_id") from exc

    service = ImageGenerationShareService(db)
    detail = await service.get_public_share_detail(
        share_id=share_uuid,
        base_url=str(request.base_url).rstrip("/") if request else None,
    )
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    return detail


__all__ = ["router"]
