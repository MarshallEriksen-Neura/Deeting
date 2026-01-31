from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user
from app.models import User
from app.schemas.media_asset import (
    AssetUploadCompleteRequest,
    AssetUploadCompleteResponse,
    AssetUploadInitRequest,
    AssetUploadInitResponse,
    AssetSignRequest,
    AssetSignResponse,
)
from app.services.oss.asset_storage_service import (
    AssetStorageNotConfigured,
    SignedAssetUrlError,
    build_signed_asset_url,
    get_effective_asset_storage_mode,
    load_asset_bytes,
    presign_asset_get_url,
    verify_signed_asset_request,
)
from app.services.oss.asset_upload_service import AssetUploadService

router = APIRouter(tags=["media"])
logger = logging.getLogger(__name__)


@router.get("/media/assets/{object_key:path}", include_in_schema=False)
async def get_asset(
    object_key: str,
    expires: int = Query(..., description="Unix timestamp (seconds)"),
    sig: str = Query(..., description="HMAC signature"),
):
    """
    通过“网关短链签名”访问业务资产。

    - 无需额外鉴权；通过 expires+sig 校验；
    - local 模式：网关直接返回二进制；
    - oss 模式：校验后 302 跳转到对象存储的预签名 URL。
    """
    try:
        verify_signed_asset_request(object_key, expires=expires, sig=sig)
    except SignedAssetUrlError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except AssetStorageNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    if get_effective_asset_storage_mode() == "local":
        try:
            body, content_type = await load_asset_bytes(object_key)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found") from exc
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found") from exc
        return Response(content=body, media_type=content_type, headers={"Cache-Control": "no-store"})

    try:
        remaining = max(1, int(expires) - int(time.time()))
        url = await presign_asset_get_url(object_key, expires_seconds=remaining)
    except AssetStorageNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found") from exc

    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND, headers={"Cache-Control": "no-store"})


@router.post("/media/assets/upload/init", response_model=AssetUploadInitResponse)
async def init_asset_upload(
    payload: AssetUploadInitRequest,
    request: Request,
    bucket_type: str = Query("private", description="存储桶类型: public 或 private"),
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> AssetUploadInitResponse:
    """初始化资产上传（全局去重 + 预签名直传）
    
    - bucket_type=public: 使用公共桶，返回永久访问 URL（适合头像等公开资源）
    - bucket_type=private: 使用私有桶，返回签名 URL（适合敏感文件）
    """
    service = AssetUploadService(db)
    try:
        result = await service.init_upload(
            content_hash=payload.content_hash,
            size_bytes=payload.size_bytes,
            content_type=payload.content_type,
            kind=payload.kind,
            base_url=str(request.base_url).rstrip("/"),
            expires_seconds=payload.expires_seconds,
            uploader_user_id=user.id,
            bucket_type=bucket_type,
        )
    except AssetStorageNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssetUploadInitResponse(**result)


@router.post("/media/assets/upload/complete", response_model=AssetUploadCompleteResponse)
async def complete_asset_upload(
    payload: AssetUploadCompleteRequest,
    request: Request,
    bucket_type: str = Query("private", description="存储桶类型: public 或 private"),
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> AssetUploadCompleteResponse:
    """完成上传确认（写入去重索引）
    
    - bucket_type=public: 返回公共桶永久访问 URL
    - bucket_type=private: 返回私有桶签名 URL
    """
    service = AssetUploadService(db)
    try:
        result = await service.complete_upload(
            object_key=payload.object_key,
            content_hash=payload.content_hash,
            size_bytes=payload.size_bytes,
            content_type=payload.content_type,
            base_url=str(request.base_url).rstrip("/"),
            uploader_user_id=user.id,
            bucket_type=bucket_type,
        )
    except AssetStorageNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssetUploadCompleteResponse(**result)


@router.post("/media/assets/sign", response_model=AssetSignResponse)
async def sign_assets(
    payload: AssetSignRequest,
    request: Request,
    user: User = Depends(get_current_active_user),
) -> AssetSignResponse:
    """批量生成资源签名 URL"""
    base_url = str(request.base_url).rstrip("/") if request else None
    try:
        assets = [
            {
                "object_key": object_key,
                "asset_url": build_signed_asset_url(
                    object_key,
                    base_url=base_url,
                    ttl_seconds=payload.expires_seconds,
                ),
            }
            for object_key in payload.object_keys
        ]
    except AssetStorageNotConfigured as exc:
        logger.warning("sign_assets_not_configured err=%s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return AssetSignResponse(assets=assets)


__all__ = ["router"]
