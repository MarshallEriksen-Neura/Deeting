from __future__ import annotations

import hashlib
from uuid import UUID

from app.core.config import settings

# 兼容历史常量
QDRANT_SYS_TOOL_INDEX_COLLECTION = "sys_tool_index"


def _normalize_user_id_hex(user_id: UUID | str) -> str:
    if isinstance(user_id, UUID):
        return user_id.hex
    return UUID(str(user_id)).hex


def _normalize_user_id_uuid(user_id: UUID | str) -> UUID:
    if isinstance(user_id, UUID):
        return user_id
    return UUID(str(user_id))


def _stable_short_hash(value: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return "unknown"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def get_kb_system_collection_name() -> str:
    return str(getattr(settings, "QDRANT_KB_SYSTEM_COLLECTION", "kb_system") or "kb_system").strip()


def get_kb_candidates_collection_name() -> str:
    return str(
        getattr(settings, "QDRANT_KB_CANDIDATES_COLLECTION", "kb_candidates") or "kb_candidates"
    ).strip()


def get_kb_user_collection_name(
    user_id: UUID | str,
    *,
    embedding_model: str | None = None,
) -> str:
    prefix = str(getattr(settings, "QDRANT_KB_USER_COLLECTION", "kb_user") or "kb_user").strip()
    if not prefix:
        prefix = "kb_user"

    strategy = (
        str(getattr(settings, "QDRANT_KB_USER_COLLECTION_STRATEGY", "per_user") or "per_user")
        .strip()
        .lower()
    )
    if strategy == "shared":
        shared = (
            str(getattr(settings, "QDRANT_KB_USER_SHARED_COLLECTION", "kb_shared_v1") or "kb_shared_v1")
        ).strip()
        return shared or "kb_shared_v1"
    if strategy == "sharded_by_model":
        shards = int(getattr(settings, "QDRANT_KB_USER_COLLECTION_SHARDS", 16) or 16)
        if shards <= 0:
            raise ValueError("qdrant_kb_user_collection_shards must be positive")
        model = (embedding_model or "").strip()
        if not model:
            raise ValueError("embedding_model is required when strategy=sharded_by_model")
        model_hash = _stable_short_hash(model)
        uid = _normalize_user_id_uuid(user_id)
        shard_idx = int(uid.int % shards)
        return f"{prefix}_{model_hash}_shard_{shard_idx:04d}"

    return f"{prefix}_{_normalize_user_id_hex(user_id)}"


def get_tool_system_collection_name() -> str:
    default_name = QDRANT_SYS_TOOL_INDEX_COLLECTION
    return str(getattr(settings, "QDRANT_TOOL_SYSTEM_COLLECTION", default_name) or default_name).strip()


def get_kb_user_tool_collection_name(user_id: UUID | str) -> str:
    prefix = str(getattr(settings, "QDRANT_TOOL_USER_COLLECTION_PREFIX", "kb_user") or "kb_user").strip()
    if not prefix:
        prefix = "kb_user"
    return f"{prefix}_{_normalize_user_id_hex(user_id)}_tools"


__all__ = [
    "QDRANT_SYS_TOOL_INDEX_COLLECTION",
    "get_kb_candidates_collection_name",
    "get_kb_system_collection_name",
    "get_kb_user_collection_name",
    "get_kb_user_tool_collection_name",
    "get_tool_system_collection_name",
]
