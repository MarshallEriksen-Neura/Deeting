"""
用户自助 API Key 路由 (/api/v1/api-keys)
"""
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.deps.auth import get_current_user
from app.models import User
from app.models.api_key import ApiKeyStatus, ApiKeyType
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.repositories.api_key import ApiKeyRepository
from app.schemas.user_api_key import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyListResponse,
    ApiKeyResponse,
)
from app.services.api_key import ApiKeyService

router = APIRouter(prefix="/api-keys", tags=["API Keys"])
models_router = APIRouter(prefix="/models", tags=["Models"])


def map_expiration(expiration: str, expires_at: Optional[datetime]) -> Optional[datetime]:
    now = datetime.utcnow()
    if expiration == "never":
        return None
    if expiration == "7d":
        return now + timedelta(days=7)
    if expiration == "30d":
        return now + timedelta(days=30)
    if expiration == "90d":
        return now + timedelta(days=90)
    return expires_at


def to_response(api_key) -> ApiKeyResponse:
    return ApiKeyResponse(
        id=api_key.id,
        user_id=api_key.user_id,
        name=api_key.name,
        prefix=api_key.key_prefix,
        budget_limit=float(api_key.budget_limit) if api_key.budget_limit is not None else None,
        budget_used=float(api_key.budget_used or 0),
        allowed_models=api_key.allowed_models or [],
        rate_limit=api_key.rate_limit_rpm,
        allowed_ips=api_key.allowed_ips or [],
        enable_logging=bool(api_key.enable_logging),
        status=api_key.status.value if hasattr(api_key.status, "value") else api_key.status,
        last_used_at=api_key.last_used_at,
        expires_at=api_key.expires_at,
        created_at=api_key.created_at,
        updated_at=api_key.updated_at,
    )


async def get_service(db: AsyncSession = Depends(get_db)) -> ApiKeyService:
    repo = ApiKeyRepository(db)
    return ApiKeyService(repository=repo, redis_client=None, secret_key=settings.SECRET_KEY)


@router.get("", response_model=ApiKeyListResponse)
async def list_api_keys(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    service: ApiKeyService = Depends(get_service),
) -> ApiKeyListResponse:
    keys = await service.repository.list_keys(user_id=current_user.id)
    total = len(keys)
    start = (page - 1) * page_size
    end = start + page_size
    items = [to_response(k) for k in keys[start:end]]
    return ApiKeyListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    payload: ApiKeyCreateRequest,
    current_user: User = Depends(get_current_user),
    service: ApiKeyService = Depends(get_service),
) -> ApiKeyCreateResponse:
    expires_at = map_expiration(payload.expiration, payload.expires_at)

    api_key, raw_key, _ = await service.generate_key(
        key_type=ApiKeyType.INTERNAL,
        name=payload.name,
        created_by=current_user.id,
        user_id=current_user.id,
        expires_at=expires_at,
        allowed_models=payload.allowed_models,
        allowed_ips=payload.allowed_ips,
        budget_limit=payload.budget_limit,
        rate_limit_rpm=payload.rate_limit,
        enable_logging=payload.enable_logging,
    )

    await service.repository.session.commit()

    return ApiKeyCreateResponse(api_key=to_response(api_key), secret=raw_key)


@router.post("/{api_key_id}/roll", response_model=ApiKeyCreateResponse)
async def roll_api_key(
    api_key_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ApiKeyService = Depends(get_service),
) -> ApiKeyCreateResponse:
    key = await service.repository.get_by_id(api_key_id)
    if not key or key.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key not found")

    new_key, raw_key, _ = await service.rotate_key(api_key_id)
    if not new_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Rotate failed")

    await service.repository.session.commit()
    return ApiKeyCreateResponse(api_key=to_response(new_key), secret=raw_key)


@router.post("/{api_key_id}/revoke", response_model=ApiKeyResponse)
async def revoke_api_key(
    api_key_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ApiKeyService = Depends(get_service),
) -> ApiKeyResponse:
    key = await service.repository.get_by_id(api_key_id)
    if not key or key.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key not found")

    revoked = await service.repository.revoke(api_key_id, reason="user revoke")
    await service.repository.session.commit()
    return to_response(revoked)


@router.delete("/{api_key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(
    api_key_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ApiKeyService = Depends(get_service),
):
    key = await service.repository.get_by_id(api_key_id)
    if not key or key.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key not found")
    await service.repository.delete(api_key_id)
    await service.repository.session.commit()
    return None


@models_router.get("/available", response_model=dict)
async def available_models(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(distinct(ProviderModel.model_id))
        .join(ProviderInstance, ProviderInstance.id == ProviderModel.instance_id)
        .where(ProviderInstance.user_id == current_user.id)
        .where(ProviderInstance.is_enabled.is_(True))
        .where(ProviderModel.is_active.is_(True))
    )
    res = await db.execute(stmt)
    items = [row[0] for row in res.all()]
    return {"items": items}
