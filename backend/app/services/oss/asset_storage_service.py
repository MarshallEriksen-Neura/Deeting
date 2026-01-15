from __future__ import annotations

import base64
import hmac
import mimetypes
import time
import uuid
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import anyio

from app.core.logging import logger
from app.core.config import settings


class AssetStorageNotConfigured(RuntimeError):
    """缺少必要的对象存储配置。"""


class SignedAssetUrlError(ValueError):
    """短链签名错误或已过期。"""


def _normalize_prefix(value: str | None) -> str:
    raw = str(value or "").strip().strip("/")
    return raw.replace("\\", "/")


def _normalize_object_key(key: str) -> str:
    return str(key or "").lstrip("/").replace("\\", "/")


def _guess_ext(content_type: str | None) -> str:
    if content_type:
        guessed = mimetypes.guess_extension(content_type, strict=False) or ""
        if guessed:
            return guessed.lstrip(".")
    return "bin"


def _build_object_key(*, ext: str, kind: str | None = None) -> str:
    base_prefix = _normalize_prefix(settings.ASSET_OSS_PREFIX)
    prefix = base_prefix
    if kind:
        kind = _normalize_prefix(kind)
        prefix = f"{base_prefix}/{kind}" if base_prefix else kind
    uid = uuid.uuid4().hex
    date_part = time.strftime("%Y/%m/%d", time.gmtime())
    filename = f"{uid}.{ext}"
    if prefix:
        return f"{prefix}/{date_part}/{filename}"
    return f"{date_part}/{filename}"


def _local_base_dir() -> Path:
    base = Path(str(settings.ASSET_LOCAL_DIR or "backend/media/assets")).expanduser()
    return base.resolve()


def _local_path_for_object_key(object_key: str) -> Path:
    raw = _normalize_object_key(object_key)
    parts = [p for p in raw.split("/") if p]
    if not parts:
        raise ValueError("empty object key")
    if any(p in {".", ".."} for p in parts):
        raise ValueError("invalid object key path")

    base_dir = _local_base_dir()
    target = base_dir.joinpath(*parts).resolve()
    if not target.is_relative_to(base_dir):
        raise ValueError("invalid object key path")
    return target


def _oss_backend_kind() -> Literal["aliyun_oss", "s3"]:
    kind = str(settings.OSS_PROVIDER or "aliyun_oss").strip().lower()
    if kind not in ("aliyun_oss", "s3"):
        raise AssetStorageNotConfigured(f"unsupported storage provider: {kind}")
    return kind  # type: ignore[return-value]


def _resolve_endpoint() -> str:
    return str(settings.OSS_ENDPOINT or "").strip()


def _resolve_region() -> str:
    return str(settings.OSS_REGION or "").strip()


def _resolve_bucket() -> str:
    # 业务资产默认走私有桶，兜底公共桶
    return str(settings.OSS_PRIVATE_BUCKET or settings.OSS_PUBLIC_BUCKET or "").strip()


def _resolve_access_key_id() -> str:
    return str(settings.OSS_ACCESS_KEY_ID or "").strip()


def _resolve_access_key_secret() -> str:
    return str(settings.OSS_ACCESS_KEY_SECRET or "").strip()


def _oss_is_configured() -> bool:
    required = (_resolve_endpoint(), _resolve_bucket(), _resolve_access_key_id(), _resolve_access_key_secret())
    return all(bool(str(v or "").strip()) for v in required)


def get_effective_asset_storage_mode() -> Literal["local", "oss"]:
    mode = str(settings.ASSET_STORAGE_MODE or "auto").strip().lower()
    if mode == "local":
        return "local"
    if mode == "oss":
        return "oss"
    if mode != "auto":
        logger.warning("Unknown ASSET_STORAGE_MODE=%s; fallback to auto", mode)
    return "oss" if _oss_is_configured() else "local"


def _create_oss_bucket():
    if not _oss_is_configured():
        raise AssetStorageNotConfigured("OSS_* 未配置，无法启用 OSS 存储")
    try:
        import oss2  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise AssetStorageNotConfigured("缺少依赖 oss2，请安装后端依赖。") from exc
    auth = oss2.Auth(_resolve_access_key_id(), _resolve_access_key_secret())
    return oss2.Bucket(auth, _resolve_endpoint(), _resolve_bucket())


def _create_s3_client():
    if not _oss_is_configured():
        raise AssetStorageNotConfigured("OSS_* 未配置，无法启用 S3/R2 存储")
    try:
        import boto3  # type: ignore
        from botocore.config import Config  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise AssetStorageNotConfigured("缺少依赖 boto3，请安装后端依赖。") from exc
    session = boto3.session.Session()
    return session.client(
        "s3",
        endpoint_url=_resolve_endpoint() or None,
        region_name=_resolve_region() or None,
        aws_access_key_id=_resolve_access_key_id() or None,
        aws_secret_access_key=_resolve_access_key_secret() or None,
        config=Config(signature_version="s3v4"),
    )


@dataclass(frozen=True)
class StoredAsset:
    object_key: str
    content_type: str
    size_bytes: int


@dataclass(frozen=True)
class AssetObjectMeta:
    size_bytes: int
    content_type: str
    etag: str | None
    metadata: dict[str, str]


async def store_asset_bytes(
    data: bytes,
    *,
    content_type: str | None = None,
    kind: str | None = None,
) -> StoredAsset:
    if not data:
        raise ValueError("empty asset bytes")

    detected_type = content_type or mimetypes.guess_type("file")[0] or "application/octet-stream"
    ext = _guess_ext(detected_type)
    object_key = _build_object_key(ext=ext, kind=kind)

    mode = get_effective_asset_storage_mode()

    def _put_local() -> None:
        path = _local_path_for_object_key(object_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def _put_oss() -> None:
        bucket = _create_oss_bucket()
        bucket.put_object(object_key, data, headers={"Content-Type": detected_type})

    def _put_s3() -> None:
        client = _create_s3_client()
        client.put_object(
            Bucket=_resolve_bucket(),
            Key=object_key,
            Body=data,
            ContentType=detected_type,
        )

    if mode == "local":
        await anyio.to_thread.run_sync(_put_local)
    else:
        if _oss_backend_kind() == "aliyun_oss":
            await anyio.to_thread.run_sync(_put_oss)
        else:
            await anyio.to_thread.run_sync(_put_s3)

    return StoredAsset(object_key=object_key, content_type=detected_type, size_bytes=len(data))


async def store_asset_b64(
    b64_data: str,
    *,
    content_type: str | None = None,
    kind: str | None = None,
) -> StoredAsset:
    try:
        raw = base64.b64decode(b64_data)
    except Exception as exc:
        raise ValueError("invalid base64 data") from exc
    return await store_asset_bytes(raw, content_type=content_type, kind=kind)


async def load_asset_bytes(object_key: str) -> tuple[bytes, str]:
    if get_effective_asset_storage_mode() == "local":
        def _get_local() -> tuple[bytes, str]:
            path = _local_path_for_object_key(object_key)
            body = path.read_bytes()
            guessed = mimetypes.guess_type(path.name)[0] or ""
            content_type = str(guessed or "application/octet-stream")
            return body, content_type

        return await anyio.to_thread.run_sync(_get_local)

    if not _oss_is_configured():
        raise AssetStorageNotConfigured("OSS_* 未配置，无法读取 OSS/S3 对象")

    def _get_oss() -> tuple[bytes, str]:
        bucket = _create_oss_bucket()
        result = bucket.get_object(object_key)
        content_type = str(getattr(result, "content_type", None) or "")
        if not content_type:
            headers: Any = getattr(result, "headers", None)
            if isinstance(headers, dict):
                content_type = str(headers.get("Content-Type") or headers.get("content-type") or "")
        body = result.read()
        if not content_type:
            content_type = mimetypes.guess_type(object_key)[0] or "application/octet-stream"
        return body, content_type

    def _get_s3() -> tuple[bytes, str]:
        client = _create_s3_client()
        result = client.get_object(Bucket=_resolve_bucket(), Key=object_key)
        body_bytes: bytes = result["Body"].read()
        content_type = str(result.get("ContentType") or mimetypes.guess_type(object_key)[0] or "application/octet-stream")
        return body_bytes, content_type

    if _oss_backend_kind() == "aliyun_oss":
        return await anyio.to_thread.run_sync(_get_oss)
    return await anyio.to_thread.run_sync(_get_s3)


def _hmac_signature(object_key: str, expires_at: int) -> str:
    secret = str(settings.SECRET_KEY or "").encode("utf-8")
    if not secret:
        raise AssetStorageNotConfigured("SECRET_KEY 未配置，无法生成签名")
    msg = f"{object_key}\n{int(expires_at)}".encode("utf-8")
    return hmac.new(secret, msg, sha256).hexdigest()


def _build_upload_headers(*, content_type: str, content_hash: str | None = None) -> dict[str, str]:
    headers = {"Content-Type": content_type}
    if content_hash:
        if _oss_backend_kind() == "aliyun_oss":
            headers["x-oss-meta-sha256"] = content_hash
        else:
            headers["x-amz-meta-sha256"] = content_hash
    return headers


def _extract_metadata_from_headers(headers: dict[str, Any]) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for key, value in headers.items():
        lower_key = str(key).lower()
        if lower_key.startswith("x-oss-meta-"):
            meta_key = lower_key.replace("x-oss-meta-", "", 1)
            metadata[meta_key] = str(value)
    return metadata


def build_signed_asset_url(
    object_key: str,
    *,
    base_url: str | None = None,
    ttl_seconds: int | None = None,
) -> str:
    api_base = (base_url or "").rstrip("/")
    if not api_base:
        api_base = "http://localhost:8000"

    api_prefix = str(getattr(settings, "API_V1_STR", "/api/v1") or "/api/v1").rstrip("/")
    if not api_prefix.startswith("/"):
        api_prefix = "/" + api_prefix

    ttl = int(ttl_seconds or settings.ASSET_SIGNED_URL_TTL_SECONDS or 3600)
    expires_at = int(time.time()) + max(1, ttl)
    sig = _hmac_signature(object_key, expires_at)

    safe_key = quote(_normalize_object_key(object_key), safe="/")
    return f"{api_base}{api_prefix}/media/assets/{safe_key}?expires={expires_at}&sig={sig}"


def verify_signed_asset_request(object_key: str, *, expires: int, sig: str) -> None:
    now = int(time.time())
    if int(expires) <= now:
        raise SignedAssetUrlError("signed url expired")

    expected = _hmac_signature(object_key, int(expires))
    if not hmac.compare_digest(str(sig or ""), expected):
        raise SignedAssetUrlError("invalid signature")

    prefix = _normalize_prefix(settings.ASSET_OSS_PREFIX)
    if prefix and not str(object_key).startswith(prefix + "/"):
        raise SignedAssetUrlError("invalid object key prefix")


async def head_asset_object(object_key: str) -> AssetObjectMeta:
    if get_effective_asset_storage_mode() == "local":
        raise AssetStorageNotConfigured("ASSET_STORAGE_MODE=local 时不支持获取对象元信息")
    if not _oss_is_configured():
        raise AssetStorageNotConfigured("OSS_* 未配置，无法获取对象元信息")

    def _head_oss() -> AssetObjectMeta:
        bucket = _create_oss_bucket()
        if hasattr(bucket, "head_object"):
            result = bucket.head_object(object_key)
        else:
            result = bucket.get_object_meta(object_key)
        headers = getattr(result, "headers", None)
        header_map: dict[str, Any] = {}
        if isinstance(headers, dict):
            header_map = {str(k).lower(): v for k, v in headers.items()}
        content_length = getattr(result, "content_length", None) or header_map.get("content-length")
        content_type = getattr(result, "content_type", None) or header_map.get("content-type") or ""
        etag = getattr(result, "etag", None) or header_map.get("etag")
        metadata = _extract_metadata_from_headers(header_map)
        return AssetObjectMeta(
            size_bytes=int(content_length or 0),
            content_type=str(content_type or ""),
            etag=str(etag).strip('"') if etag else None,
            metadata=metadata,
        )

    def _head_s3() -> AssetObjectMeta:
        client = _create_s3_client()
        result = client.head_object(Bucket=_resolve_bucket(), Key=object_key)
        metadata = {
            str(key).lower(): str(val)
            for key, val in (result.get("Metadata") or {}).items()
        }
        etag = str(result.get("ETag") or "").strip('"') or None
        return AssetObjectMeta(
            size_bytes=int(result.get("ContentLength") or 0),
            content_type=str(result.get("ContentType") or ""),
            etag=etag,
            metadata=metadata,
        )

    if _oss_backend_kind() == "aliyun_oss":
        return await anyio.to_thread.run_sync(_head_oss)
    return await anyio.to_thread.run_sync(_head_s3)


async def presign_asset_get_url(object_key: str, *, expires_seconds: int) -> str:
    if get_effective_asset_storage_mode() == "local":
        raise AssetStorageNotConfigured("ASSET_STORAGE_MODE=local 时不支持生成预签名 URL")
    if not _oss_is_configured():
        raise AssetStorageNotConfigured("OSS_* 未配置，无法生成预签名 URL")
    ttl = int(expires_seconds)
    if ttl <= 0:
        raise ValueError("expires_seconds must be positive")

    def _sign_oss() -> str:
        bucket = _create_oss_bucket()
        return bucket.sign_url("GET", object_key, ttl)

    def _sign_s3() -> str:
        client = _create_s3_client()
        return client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": _resolve_bucket(), "Key": object_key},
            ExpiresIn=ttl,
        )

    if _oss_backend_kind() == "aliyun_oss":
        return await anyio.to_thread.run_sync(_sign_oss)
    return await anyio.to_thread.run_sync(_sign_s3)


async def presign_asset_put_url(
    *,
    content_type: str,
    kind: str | None = None,
    expires_seconds: int = 3600,
    content_hash: str | None = None,
) -> tuple[str, str, int, dict[str, str]]:
    if get_effective_asset_storage_mode() == "local":
        raise AssetStorageNotConfigured("ASSET_STORAGE_MODE=local 时不支持生成上传预签名 URL")
    if not _oss_is_configured():
        raise AssetStorageNotConfigured("OSS_* 未配置，无法生成上传预签名 URL")
    ttl = int(expires_seconds)
    if ttl <= 0:
        raise ValueError("expires_seconds must be positive")

    ext = _guess_ext(content_type)
    object_key = _build_object_key(ext=ext, kind=kind)

    upload_headers = _build_upload_headers(content_type=content_type, content_hash=content_hash)

    def _sign_oss() -> str:
        bucket = _create_oss_bucket()
        return bucket.sign_url(
            "PUT",
            object_key,
            ttl,
            headers=upload_headers,
        )

    def _sign_s3() -> str:
        client = _create_s3_client()
        return client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": _resolve_bucket(),
                "Key": object_key,
                "ContentType": content_type,
                "Metadata": {"sha256": content_hash} if content_hash else {},
            },
            ExpiresIn=ttl,
        )

    if _oss_backend_kind() == "aliyun_oss":
        url = await anyio.to_thread.run_sync(_sign_oss)
    else:
        url = await anyio.to_thread.run_sync(_sign_s3)

    return object_key, str(url), ttl, upload_headers


__all__ = [
    "AssetStorageNotConfigured",
    "SignedAssetUrlError",
    "StoredAsset",
    "AssetObjectMeta",
    "build_signed_asset_url",
    "get_effective_asset_storage_mode",
    "head_asset_object",
    "load_asset_bytes",
    "presign_asset_get_url",
    "presign_asset_put_url",
    "store_asset_b64",
    "store_asset_bytes",
    "verify_signed_asset_request",
]
