from __future__ import annotations

import logging
from typing import Any

import httpx

QDRANT_DEFAULT_VECTOR_NAME = "text"

logger = logging.getLogger(__name__)
_collection_vector_cache: dict[str, tuple[list[str], bool]] = {}


def _safe_raise(resp: httpx.Response) -> None:
    try:
        req = getattr(resp, "request", None)
    except RuntimeError:  # pragma: no cover - httpx 异常分支
        req = None
    if req is None:
        return
    resp.raise_for_status()


def _dig(obj: Any, *keys: str) -> Any:
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _named_vector_struct(name: str, vector: list[float]) -> dict[str, Any]:
    return {"name": name, "vector": vector}


async def get_collection_vector_size(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    vector_name: str = QDRANT_DEFAULT_VECTOR_NAME,
) -> int | None:
    name = str(collection_name or "").strip()
    if not name:
        raise ValueError("empty collection_name")

    resp = await qdrant.get(f"/collections/{name}")
    if resp.status_code == 404:
        return None
    _safe_raise(resp)
    payload = resp.json()

    vectors = _dig(payload, "result", "config", "params", "vectors")
    size = None
    vn = (
        str(vector_name or QDRANT_DEFAULT_VECTOR_NAME).strip()
        or QDRANT_DEFAULT_VECTOR_NAME
    )
    if isinstance(vectors, dict):
        # 平铺结构 {"size": 2, "distance": "..."}（未命名向量）
        if "size" in vectors:
            size = _dig(vectors, "size")
            if isinstance(size, int) and size > 0:
                _collection_vector_cache[name] = ([], True)
                logger.warning(
                    "qdrant collection uses unnamed vectors; fallback to unnamed size",
                    extra={"collection": name, "expected_vector": vn},
                )
                return size
            raise RuntimeError(
                f"unexpected qdrant collection response (missing vector size): {payload!r}"
            )

        _collection_vector_cache[name] = (
            [key for key in vectors.keys() if isinstance(key, str) and key],
            False,
        )
        size = _dig(vectors, vn, "size")
        if isinstance(size, int) and size > 0:
            return size
        # Fallback: if collection has a single named vector, reuse it.
        vector_names = [key for key in vectors.keys() if isinstance(key, str) and key]
        if len(vector_names) == 1:
            fallback_name = vector_names[0]
            size = _dig(vectors, fallback_name, "size")
            if isinstance(size, int) and size > 0:
                logger.warning(
                    "qdrant collection vector name mismatch; fallback to existing name",
                    extra={
                        "collection": name,
                        "expected_vector": vn,
                        "actual_vector": fallback_name,
                    },
                )
                return size
    else:
        size = _dig(payload, "result", "config", "params", "vectors", "size")
        if isinstance(size, int) and size > 0:
            _collection_vector_cache[name] = ([], True)
            return size
    raise RuntimeError(
        f"unexpected qdrant collection response (missing vector size): {payload!r}"
    )


async def _get_collection_vector_names(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    force_refresh: bool = False,
) -> tuple[list[str], bool]:
    name = str(collection_name or "").strip()
    if not name:
        raise ValueError("empty collection_name")
    cached = _collection_vector_cache.get(name)
    if cached is not None and not force_refresh:
        return cached
    resp = await qdrant.get(f"/collections/{name}")
    if resp.status_code == 404:
        return [], False
    _safe_raise(resp)
    payload = resp.json()
    vectors = _dig(payload, "result", "config", "params", "vectors")
    if isinstance(vectors, dict):
        if "size" in vectors:
            _collection_vector_cache[name] = ([], True)
            return [], True
        names = [key for key in vectors.keys() if isinstance(key, str) and key]
        _collection_vector_cache[name] = (names, False)
        return names, False
    return [], False


async def _resolve_vector_name(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    preferred: str,
) -> tuple[str, bool]:
    names, unnamed = await _get_collection_vector_names(
        qdrant, collection_name=collection_name
    )
    cleaned = (preferred or "").strip() or QDRANT_DEFAULT_VECTOR_NAME
    if unnamed:
        raise RuntimeError(
            "qdrant collection uses unnamed vectors; expected named vector "
            f"'{cleaned}' (collection={collection_name})"
        )
    if names and cleaned not in names:
        raise RuntimeError(
            "qdrant collection vector name mismatch; expected "
            f"'{cleaned}', got {names} (collection={collection_name})"
        )
    return cleaned, False


async def create_collection(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    vector_size: int,
    distance: str = "Cosine",
    vector_name: str = QDRANT_DEFAULT_VECTOR_NAME,
) -> None:
    name = str(collection_name or "").strip()
    if not name:
        raise ValueError("empty collection_name")
    size = int(vector_size)
    if size <= 0:
        raise ValueError("vector_size must be positive")

    vn = str(vector_name or "").strip() or QDRANT_DEFAULT_VECTOR_NAME
    vectors: dict[str, Any] = {
        vn: {"size": size, "distance": str(distance or "Cosine")}
    }
    body = {"vectors": vectors}
    resp = await qdrant.put(f"/collections/{name}", json=body)
    _safe_raise(resp)
    _collection_vector_cache[name] = ([vn], False)


async def ensure_collection_vector_size(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    vector_size: int,
    vector_name: str = QDRANT_DEFAULT_VECTOR_NAME,
) -> int:
    existing = await get_collection_vector_size(
        qdrant, collection_name=collection_name, vector_name=vector_name
    )
    expected = int(vector_size)
    if existing is not None:
        await _resolve_vector_name(
            qdrant,
            collection_name=collection_name,
            preferred=str(vector_name or "").strip() or QDRANT_DEFAULT_VECTOR_NAME,
        )
        if existing != expected:
            raise RuntimeError(
                f"qdrant collection vector size mismatch: collection={collection_name} "
                f"existing={existing} expected={expected}"
            )
        return existing

    await create_collection(
        qdrant,
        collection_name=collection_name,
        vector_size=expected,
        distance="Cosine",
        vector_name=vector_name,
    )
    return expected


async def upsert_point(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    point_id: str,
    vector: list[float],
    payload: dict[str, Any],
    wait: bool = True,
    vector_name: str = QDRANT_DEFAULT_VECTOR_NAME,
) -> None:
    name = str(collection_name or "").strip()
    if not name:
        raise ValueError("empty collection_name")
    pid = str(point_id or "").strip()
    if not pid:
        raise ValueError("empty point_id")
    if not isinstance(vector, list) or not vector:
        raise ValueError("empty vector")
    if not isinstance(payload, dict):
        raise ValueError("payload must be dict")

    params = {"wait": "true" if wait else "false"}
    vn = (
        str(vector_name or QDRANT_DEFAULT_VECTOR_NAME).strip()
        or QDRANT_DEFAULT_VECTOR_NAME
    )
    resolved_name, _ = await _resolve_vector_name(
        qdrant, collection_name=name, preferred=vn
    )
    body = {
        "points": [
            {
                "id": pid,
                "vector": {resolved_name: vector},
                "payload": payload,
            }
        ]
    }
    resp = await qdrant.put(f"/collections/{name}/points", params=params, json=body)
    _safe_raise(resp)


async def upsert_points(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    points: list[dict[str, Any]],
    wait: bool = True,
    vector_name: str = QDRANT_DEFAULT_VECTOR_NAME,
) -> None:
    name = str(collection_name or "").strip()
    if not name:
        raise ValueError("empty collection_name")
    if not isinstance(points, list) or not points:
        raise ValueError("points must be non-empty list")
    vn = (
        str(vector_name or QDRANT_DEFAULT_VECTOR_NAME).strip()
        or QDRANT_DEFAULT_VECTOR_NAME
    )
    resolved_name, _ = await _resolve_vector_name(
        qdrant, collection_name=name, preferred=vn
    )

    normalized: list[dict[str, Any]] = []
    for point in points:
        pid = str(point.get("id", "") or "").strip()
        vector = point.get("vector")
        payload = point.get("payload")
        if not pid:
            raise ValueError("point id is required")
        if not isinstance(vector, list) or not vector:
            raise ValueError("point vector must be non-empty list")
        if not isinstance(payload, dict):
            raise ValueError("point payload must be dict")
        normalized.append(
            {
                "id": pid,
                "vector": {resolved_name: vector},
                "payload": payload,
            }
        )

    params = {"wait": "true" if wait else "false"}
    body = {"points": normalized}
    resp = await qdrant.put(f"/collections/{name}/points", params=params, json=body)
    _safe_raise(resp)


async def search_points(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    vector: list[float],
    limit: int = 3,
    query_filter: dict[str, Any] | None = None,
    with_payload: bool = True,
    score_threshold: float | None = None,
    vector_name: str = QDRANT_DEFAULT_VECTOR_NAME,
) -> list[dict[str, Any]]:
    name = str(collection_name or "").strip()
    if not name:
        raise ValueError("empty collection_name")
    if not isinstance(vector, list) or not vector:
        raise ValueError("empty vector")
    k = int(limit or 0)
    if k <= 0:
        k = 3
    k = max(1, min(k, 50))

    vn = (
        str(vector_name or QDRANT_DEFAULT_VECTOR_NAME).strip()
        or QDRANT_DEFAULT_VECTOR_NAME
    )
    resolved_name, _ = await _resolve_vector_name(
        qdrant, collection_name=name, preferred=vn
    )
    body: dict[str, Any] = {
        "vector": _named_vector_struct(resolved_name, vector),
        "limit": k,
        "with_payload": bool(with_payload),
    }
    if score_threshold is not None:
        body["score_threshold"] = float(score_threshold)
    if query_filter is not None:
        body["filter"] = query_filter

    resp = await qdrant.post(f"/collections/{name}/points/search", json=body)
    if resp.status_code == 404:
        return []
    _safe_raise(resp)
    payload = resp.json()
    result = payload.get("result")
    if isinstance(result, list):
        return [it for it in result if isinstance(it, dict)]
    return []


async def scroll_points(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    limit: int = 20,
    query_filter: dict[str, Any] | None = None,
    with_payload: bool = True,
    offset: Any | None = None,
) -> tuple[list[dict[str, Any]], Any | None]:
    name = str(collection_name or "").strip()
    if not name:
        raise ValueError("empty collection_name")

    body: dict[str, Any] = {
        "limit": max(1, min(int(limit or 0), 100)),
        "with_payload": bool(with_payload),
        "with_vector": False,
    }
    if query_filter:
        body["filter"] = query_filter
    if offset:
        body["offset"] = offset

    resp = await qdrant.post(f"/collections/{name}/points/scroll", json=body)
    if resp.status_code == 404:
        return [], None
    _safe_raise(resp)
    payload = resp.json()
    result = payload.get("result", {})
    points = result.get("points", [])
    next_offset = result.get("next_page_offset")
    return [it for it in points if isinstance(it, dict)], next_offset


async def delete_points(
    qdrant: httpx.AsyncClient,
    *,
    collection_name: str,
    points_ids: list[str] | None = None,
    query_filter: dict[str, Any] | None = None,
    wait: bool = True,
) -> None:
    name = str(collection_name or "").strip()
    if not name:
        raise ValueError("empty collection_name")

    params = {"wait": "true" if wait else "false"}
    body: dict[str, Any] = {}
    if points_ids:
        body["points"] = points_ids
    if query_filter:
        body["filter"] = query_filter

    if not body:
        return

    resp = await qdrant.post(
        f"/collections/{name}/points/delete", params=params, json=body
    )
    if resp.request is not None:
        resp.raise_for_status()


__all__ = [
    "QDRANT_DEFAULT_VECTOR_NAME",
    "create_collection",
    "delete_points",
    "ensure_collection_vector_size",
    "get_collection_vector_size",
    "scroll_points",
    "search_points",
    "upsert_point",
    "upsert_points",
]
