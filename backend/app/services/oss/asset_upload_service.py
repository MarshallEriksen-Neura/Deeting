from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models.media_asset import MediaAsset
from app.repositories.media_asset_repository import MediaAssetRepository
from app.services.oss.asset_storage_service import (
    AssetObjectMeta,
    AssetStorageNotConfigured,
    build_public_asset_url,
    build_signed_asset_url,
    head_asset_object,
    presign_asset_put_url,
)


class AssetUploadService:
    """预签名上传 + 全局去重服务"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.asset_repo = MediaAssetRepository(session)

    async def init_upload(
        self,
        *,
        content_hash: str,
        size_bytes: int,
        content_type: str,
        kind: str | None,
        base_url: str,
        expires_seconds: int | None,
        uploader_user_id=None,
        bucket_type: str = "private",
    ) -> dict:
        """初始化上传
        
        Args:
            bucket_type: "private" 或 "public"，决定存储桶和返回的 URL 类型
        """
        existing = await self.asset_repo.get_by_hash(content_hash, size_bytes)
        if existing:
            if await self._validate_existing(existing, content_hash, size_bytes, content_type):
                # 根据 bucket_type 返回不同格式的 asset_url
                if bucket_type == "public":
                    asset_url = build_public_asset_url(existing.object_key)
                else:
                    asset_url = build_signed_asset_url(existing.object_key, base_url=base_url)
                
                return {
                    "deduped": True,
                    "object_key": existing.object_key,
                    "asset_url": asset_url,
                    "upload_url": None,
                    "upload_headers": None,
                    "expires_in": None,
                }

            try:
                await self.asset_repo.delete_asset(existing, commit=True)
            except Exception:
                await self.session.rollback()
                logger.warning(
                    "media_asset_stale_cleanup_failed",
                    extra={"asset_id": str(existing.id), "object_key": existing.object_key},
                )

        object_key, upload_url, ttl, upload_headers = await presign_asset_put_url(
            content_type=content_type,
            kind=kind,
            expires_seconds=expires_seconds or 3600,
            content_hash=content_hash,
            bucket_type=bucket_type,
        )
        return {
            "deduped": False,
            "object_key": object_key,
            "asset_url": None,
            "upload_url": upload_url,
            "upload_headers": upload_headers,
            "expires_in": ttl,
        }

    async def complete_upload(
        self,
        *,
        object_key: str,
        content_hash: str,
        size_bytes: int,
        content_type: str,
        base_url: str,
        uploader_user_id=None,
        bucket_type: str = "private",
    ) -> dict:
        """完成上传
        
        Args:
            bucket_type: "private" 或 "public"，决定返回的 URL 类型
        """
        meta = await head_asset_object(object_key)
        _ensure_meta_valid(meta, content_hash, size_bytes, content_type)

        existing = await self.asset_repo.get_by_hash(content_hash, size_bytes)
        if existing:
            # 根据 bucket_type 返回不同格式的 asset_url
            if bucket_type == "public":
                asset_url = build_public_asset_url(existing.object_key)
            else:
                asset_url = build_signed_asset_url(existing.object_key, base_url=base_url)
            
            return {
                "object_key": existing.object_key,
                "asset_url": asset_url,
            }

        asset_data = {
            "content_hash": content_hash,
            "size_bytes": size_bytes,
            "content_type": content_type,
            "object_key": object_key,
            "etag": meta.etag,
            "uploader_user_id": uploader_user_id,
        }

        try:
            asset = await self.asset_repo.create_asset(asset_data, commit=True)
        except IntegrityError:
            await self.session.rollback()
            asset = await self.asset_repo.get_by_hash(content_hash, size_bytes)
            if not asset:
                raise

        # 根据 bucket_type 返回不同格式的 asset_url
        if bucket_type == "public":
            asset_url = build_public_asset_url(asset.object_key)
        else:
            asset_url = build_signed_asset_url(asset.object_key, base_url=base_url)

        return {
            "object_key": asset.object_key,
            "asset_url": asset_url,
        }

    async def _validate_existing(
        self,
        asset: MediaAsset,
        content_hash: str,
        size_bytes: int,
        content_type: str,
    ) -> bool:
        try:
            meta = await head_asset_object(asset.object_key)
        except AssetStorageNotConfigured:
            return False
        except Exception as exc:
            logger.warning(
                "media_asset_head_failed",
                extra={"object_key": asset.object_key, "error": str(exc)},
            )
            return False

        try:
            _ensure_meta_valid(meta, content_hash, size_bytes, content_type, allow_missing_hash=True)
            return True
        except ValueError:
            return False


def _ensure_meta_valid(
    meta: AssetObjectMeta,
    content_hash: str,
    size_bytes: int,
    content_type: str,
    *,
    allow_missing_hash: bool = False,
) -> None:
    if meta.size_bytes and meta.size_bytes != size_bytes:
        raise ValueError("asset size mismatch")
    if meta.content_type and meta.content_type != content_type:
        raise ValueError("asset content type mismatch")
    meta_hash = (meta.metadata.get("sha256") or "").strip().lower()
    if not meta_hash:
        if allow_missing_hash:
            return
        raise ValueError("asset hash metadata missing")
    if meta_hash != content_hash:
        raise ValueError("asset hash mismatch")


__all__ = ["AssetUploadService"]
