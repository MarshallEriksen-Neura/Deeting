import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Generic, Iterable, TypeVar

from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_store import delete_points, ensure_collection_vector_size, upsert_points

logger = logging.getLogger(__name__)

T = TypeVar("T")
KeyFunc = Callable[[T], str]
FingerprintFunc = Callable[[T], str]
TextFunc = Callable[[T], str]
PayloadFunc = Callable[[T], dict[str, Any]]
IdFunc = Callable[[T], str]


@dataclass
class IndexDelta(Generic[T]):
    to_upsert: list[T]
    to_delete: list[T]


def stable_fingerprint(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compute_delta(
    old_items: Iterable[T],
    new_items: Iterable[T],
    *,
    key_fn: KeyFunc[T],
    fingerprint_fn: FingerprintFunc[T],
) -> IndexDelta[T]:
    old_map: dict[str, tuple[T, str]] = {}
    for item in old_items:
        key = (key_fn(item) or "").strip()
        if not key:
            continue
        old_map[key] = (item, fingerprint_fn(item))

    new_map: dict[str, tuple[T, str]] = {}
    for item in new_items:
        key = (key_fn(item) or "").strip()
        if not key:
            continue
        new_map[key] = (item, fingerprint_fn(item))

    to_upsert: list[T] = []
    to_delete: list[T] = []

    for key, (item, fp) in new_map.items():
        old = old_map.get(key)
        if old is None or old[1] != fp:
            to_upsert.append(item)

    for key, (item, _) in old_map.items():
        if key not in new_map:
            to_delete.append(item)

    return IndexDelta(to_upsert=to_upsert, to_delete=to_delete)


class QdrantIndexSyncService(Generic[T]):
    def __init__(self, embedding_service: EmbeddingService | None = None):
        self._embedding_service = embedding_service or EmbeddingService()

    async def sync(
        self,
        *,
        collection_name: str,
        old_items: Iterable[T],
        new_items: Iterable[T],
        key_fn: KeyFunc[T],
        fingerprint_fn: FingerprintFunc[T],
        text_fn: TextFunc[T],
        payload_fn: PayloadFunc[T],
        id_fn: IdFunc[T],
    ) -> IndexDelta[T]:
        delta = compute_delta(
            old_items,
            new_items,
            key_fn=key_fn,
            fingerprint_fn=fingerprint_fn,
        )
        if delta.to_upsert:
            await self.upsert(
                collection_name=collection_name,
                items=delta.to_upsert,
                text_fn=text_fn,
                payload_fn=payload_fn,
                id_fn=id_fn,
            )
        if delta.to_delete:
            await self.delete(
                collection_name=collection_name,
                items=delta.to_delete,
                id_fn=id_fn,
            )
        return delta

    async def upsert(
        self,
        *,
        collection_name: str,
        items: list[T],
        text_fn: TextFunc[T],
        payload_fn: PayloadFunc[T],
        id_fn: IdFunc[T],
    ) -> None:
        if not qdrant_is_configured():
            return
        if not items:
            return

        texts = [text_fn(item) for item in items]
        vectors = await self._embedding_service.embed_documents(texts)
        if not vectors:
            return

        client = get_qdrant_client()
        await ensure_collection_vector_size(
            client,
            collection_name=collection_name,
            vector_size=len(vectors[0]),
        )

        points: list[dict[str, Any]] = []
        for item, vector in zip(items, vectors, strict=True):
            pid = id_fn(item)
            if not pid:
                continue
            points.append(
                {
                    "id": pid,
                    "vector": vector,
                    "payload": payload_fn(item),
                }
            )

        if points:
            await upsert_points(client, collection_name=collection_name, points=points, wait=True)

    async def delete(
        self,
        *,
        collection_name: str,
        items: list[T],
        id_fn: IdFunc[T],
    ) -> None:
        if not qdrant_is_configured():
            return
        ids = []
        seen = set()
        for item in items:
            pid = (id_fn(item) or "").strip()
            if not pid or pid in seen:
                continue
            ids.append(pid)
            seen.add(pid)
        if not ids:
            return

        client = get_qdrant_client()
        try:
            await delete_points(
                client,
                collection_name=collection_name,
                points_ids=ids,
                wait=True,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("index delete failed", exc_info=exc)
