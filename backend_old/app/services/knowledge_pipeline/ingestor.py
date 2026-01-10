from __future__ import annotations

import hashlib
import time
from typing import Any

import httpx
from sqlalchemy.orm import Session as DbSession

try:
    from redis.asyncio import Redis
except ModuleNotFoundError:  # pragma: no cover
    Redis = object  # type: ignore[misc,assignment]

from app.auth import AuthenticatedAPIKey
from app.services.embedding_service import embed_text
from app.services.knowledge_pipeline.dedupe import check_duplicate, compute_simhash
from app.storage.qdrant_kb_store import ensure_collection_vector_size, upsert_point


async def ingest_chunks(
    db: DbSession,
    *,
    redis: Redis,
    client: Any,
    qdrant: httpx.AsyncClient,
    api_key: AuthenticatedAPIKey,
    effective_provider_ids: set[str],
    embedding_logical_model: str,
    chunks: list[str],
    collection_name: str,
    task_id: str,
    source_type: str = "unknown",
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Ingest text chunks into Qdrant knowledge base with deduplication.

    Process:
    1. Ensure collection exists with correct vector size
    2. For each chunk:
       - Compute SimHash fingerprint
       - Check for duplicates
       - Generate embedding via embed_text
       - Upsert to Qdrant with payload

    Args:
        db: Database session
        redis: Redis client
        client: HTTP client for upstream requests
        qdrant: Qdrant HTTP client
        api_key: Authenticated API key for embedding service
        effective_provider_ids: Provider IDs for routing
        embedding_logical_model: Logical model name for embeddings
        chunks: List of text chunks to ingest
        collection_name: Target Qdrant collection
        task_id: Task/job identifier for tracking
        source_type: Source type tag (e.g., "crawl", "upload", "api")
        tags: Additional tags for filtering/organization
        metadata: Additional metadata to store in payload

    Returns:
        Ingestion result with stats: {
            "total": int,
            "ingested": int,
            "skipped_duplicate": int,
            "skipped_empty": int,
            "failed": int,
        }
    """
    if not chunks:
        return {
            "total": 0,
            "ingested": 0,
            "skipped_duplicate": 0,
            "skipped_empty": 0,
            "failed": 0,
        }

    # Initialize counters
    stats = {
        "total": len(chunks),
        "ingested": 0,
        "skipped_duplicate": 0,
        "skipped_empty": 0,
        "failed": 0,
    }

    # Get embedding dimension by making a test call (if needed)
    # For simplicity, we'll get it from first successful embedding
    vector_size: int | None = None

    for idx, chunk in enumerate(chunks):
        chunk_text = chunk.strip()
        if not chunk_text:
            stats["skipped_empty"] += 1
            continue

        try:
            # Compute SimHash for deduplication
            simhash = compute_simhash(chunk_text)

            # Check for duplicates
            is_duplicate = await check_duplicate(
                simhash=simhash,
                collection_name=collection_name,
                qdrant=qdrant,
                threshold=3,  # Allow up to 3 bits difference
                limit=20,  # Check last 20 documents
            )

            if is_duplicate:
                stats["skipped_duplicate"] += 1
                continue

            # Generate embedding
            idempotency_key = f"kb_ingest_{task_id}_{idx}"
            vector = await embed_text(
                db=db,
                redis=redis,
                client=client,
                api_key=api_key,
                effective_provider_ids=effective_provider_ids,
                embedding_logical_model=embedding_logical_model,
                text=chunk_text,
                idempotency_key=idempotency_key,
                input_type="search_document",  # For indexing/storage
            )

            if vector is None or not vector:
                stats["failed"] += 1
                continue

            # Ensure collection exists (lazy initialization)
            if vector_size is None:
                vector_size = len(vector)
                await ensure_collection_vector_size(
                    qdrant=qdrant,
                    collection_name=collection_name,
                    vector_size=vector_size,
                )

            # Prepare payload
            payload: dict[str, Any] = {
                "text": chunk_text,
                "task_id": task_id,
                "source_type": source_type,
                "tags": tags or [],
                "simhash": simhash,
                "created_at": int(time.time()),
            }

            # Merge additional metadata
            if metadata:
                payload.update(metadata)

            # Generate unique point ID
            point_id = hashlib.md5(f"{task_id}_{idx}_{chunk_text[:100]}".encode()).hexdigest()

            # Upsert to Qdrant
            await upsert_point(
                qdrant=qdrant,
                collection_name=collection_name,
                point_id=point_id,
                vector=vector,
                payload=payload,
                wait=True,
            )

            stats["ingested"] += 1

        except Exception:
            stats["failed"] += 1
            # Continue processing remaining chunks on error
            continue

    return stats


__all__ = ["ingest_chunks"]
