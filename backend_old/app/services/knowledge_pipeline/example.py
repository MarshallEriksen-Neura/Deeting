from __future__ import annotations

"""
Knowledge Pipeline Usage Example

This example demonstrates how to use the knowledge pipeline for
document ingestion with semantic chunking, deduplication, and Qdrant storage.
"""

from app.services.knowledge_pipeline import check_duplicate, chunk_document, compute_simhash, ingest_chunks


async def example_ingest_document(
    db,
    redis,
    client,
    qdrant,
    api_key,
    effective_provider_ids,
    embedding_logical_model,
    document_text: str,
    task_id: str,
):
    """
    Example: Ingest a complete document into knowledge base.

    Args:
        db: Database session
        redis: Redis client
        client: HTTP client for upstream
        qdrant: Qdrant HTTP client
        api_key: Authenticated API key
        effective_provider_ids: Provider IDs for routing
        embedding_logical_model: Embedding model to use
        document_text: Full document text
        task_id: Task identifier

    Returns:
        Ingestion statistics
    """
    # Step 1: Chunk the document
    chunks = chunk_document(document_text, max_tokens=512)
    print(f"Chunked document into {len(chunks)} chunks")

    # Step 2: Ingest chunks with deduplication
    result = await ingest_chunks(
        db=db,
        redis=redis,
        client=client,
        qdrant=qdrant,
        api_key=api_key,
        effective_provider_ids=effective_provider_ids,
        embedding_logical_model=embedding_logical_model,
        chunks=chunks,
        collection_name="kb_system",
        task_id=task_id,
        source_type="crawl",
        tags=["documentation", "example"],
        metadata={
            "lang": "en",
            "source_url": "https://example.com/doc",
        },
    )

    print(f"Ingestion complete: {result}")
    return result


async def example_check_duplicate_content(qdrant, text: str):
    """
    Example: Check if content is duplicate before ingestion.

    Args:
        qdrant: Qdrant HTTP client
        text: Text to check

    Returns:
        True if duplicate, False otherwise
    """
    # Compute SimHash
    simhash = compute_simhash(text)

    # Check against existing content
    is_dup = await check_duplicate(
        simhash=simhash,
        collection_name="kb_system",
        qdrant=qdrant,
        threshold=3,
        limit=20,
    )

    if is_dup:
        print("Content is duplicate, skipping")
    else:
        print("Content is unique, can ingest")

    return is_dup


# Usage in API endpoint:
"""
from app.services.knowledge_pipeline import chunk_document, ingest_chunks
from app.settings import settings

@router.post("/kb/ingest")
async def ingest_knowledge(
    request: IngestRequest,
    db: DbSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    qdrant: Annotated[httpx.AsyncClient, Depends(get_qdrant_client)],
    client: Annotated[httpx.AsyncClient, Depends(get_http_client)],
    api_key: AuthenticatedAPIKey = Depends(require_auth),
):
    # Chunk document
    chunks = chunk_document(request.text, max_tokens=512)

    # Ingest with deduplication
    result = await ingest_chunks(
        db=db,
        redis=redis,
        client=client,
        qdrant=qdrant,
        api_key=api_key,
        effective_provider_ids=api_key.effective_provider_ids,
        embedding_logical_model=settings.kb_global_embedding_logical_model or "text-embedding-3-small",
        chunks=chunks,
        collection_name=settings.qdrant_kb_system_collection,
        task_id=request.task_id,
        source_type=request.source_type,
        tags=request.tags,
    )

    return result
"""
