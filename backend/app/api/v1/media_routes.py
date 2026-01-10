from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import RedirectResponse, Response

from app.services.oss.asset_storage_service import (
    AssetStorageNotConfigured,
    SignedAssetUrlError,
    get_effective_asset_storage_mode,
    load_asset_bytes,
    presign_asset_get_url,
    verify_signed_asset_request,
)

router = APIRouter(tags=["media"])


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


__all__ = ["router"]
