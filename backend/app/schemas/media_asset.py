from __future__ import annotations

from pydantic import Field, field_validator

from app.schemas.base import BaseSchema


class AssetUploadInitRequest(BaseSchema):
    content_hash: str = Field(..., description="SHA-256 内容哈希（hex）", min_length=64, max_length=64)
    size_bytes: int = Field(..., description="内容大小（字节）", gt=0)
    content_type: str = Field(..., description="内容类型", max_length=120)
    kind: str | None = Field(None, description="资源类型前缀（可选）", max_length=120)
    expires_seconds: int | None = Field(None, description="上传预签名有效期（秒）", gt=0)

    @field_validator("content_hash")
    @classmethod
    def _validate_hash(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if len(normalized) != 64 or any(ch not in "0123456789abcdef" for ch in normalized):
            raise ValueError("content_hash must be sha256 hex")
        return normalized


class AssetUploadInitResponse(BaseSchema):
    deduped: bool = Field(..., description="是否命中去重")
    object_key: str = Field(..., description="对象存储 Key")
    asset_url: str | None = Field(None, description="可直接展示的访问 URL（命中去重时返回）")
    upload_url: str | None = Field(None, description="预签名上传 URL（未命中去重时返回）")
    upload_headers: dict[str, str] | None = Field(None, description="上传时需携带的 Header")
    expires_in: int | None = Field(None, description="预签名上传有效期（秒）")


class AssetUploadCompleteRequest(BaseSchema):
    object_key: str = Field(..., description="对象存储 Key")
    content_hash: str = Field(..., description="SHA-256 内容哈希（hex）", min_length=64, max_length=64)
    size_bytes: int = Field(..., description="内容大小（字节）", gt=0)
    content_type: str = Field(..., description="内容类型", max_length=120)

    @field_validator("content_hash")
    @classmethod
    def _validate_hash(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if len(normalized) != 64 or any(ch not in "0123456789abcdef" for ch in normalized):
            raise ValueError("content_hash must be sha256 hex")
        return normalized


class AssetUploadCompleteResponse(BaseSchema):
    object_key: str = Field(..., description="对象存储 Key")
    asset_url: str = Field(..., description="可直接展示的访问 URL")


class AssetSignRequest(BaseSchema):
    object_keys: list[str] = Field(..., description="对象存储 Key 列表", min_length=1)
    expires_seconds: int | None = Field(
        None,
        description="签名有效期（秒，可选）",
        gt=0,
    )

    @field_validator("object_keys")
    @classmethod
    def _validate_object_keys(cls, value: list[str]) -> list[str]:
        cleaned = [str(item or "").strip() for item in value]
        cleaned = [item for item in cleaned if item]
        if not cleaned:
            raise ValueError("object_keys must not be empty")
        return cleaned


class AssetSignedItem(BaseSchema):
    object_key: str = Field(..., description="对象存储 Key")
    asset_url: str = Field(..., description="签名后的访问 URL")


class AssetSignResponse(BaseSchema):
    assets: list[AssetSignedItem] = Field(..., description="签名后的资源列表")


__all__ = [
    "AssetUploadCompleteRequest",
    "AssetUploadCompleteResponse",
    "AssetUploadInitRequest",
    "AssetUploadInitResponse",
    "AssetSignRequest",
    "AssetSignedItem",
    "AssetSignResponse",
]
