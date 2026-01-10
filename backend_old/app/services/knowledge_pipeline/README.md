# Knowledge Pipeline

Knowledge pipeline service for semantic chunking, deduplication, and Qdrant ingestion.

## Features

- **Semantic Chunking**: Splits documents by paragraphs and sentences while respecting token limits
- **SimHash Deduplication**: Detects near-duplicate content using locality-sensitive hashing
- **Qdrant Integration**: Stores chunks with embeddings in Qdrant vector database
- **Metadata Support**: Attaches task IDs, tags, source types, and custom metadata

## Components

### 1. Chunker (`chunker.py`)

Splits text into semantic chunks with token limits.

```python
from app.services.knowledge_pipeline import chunk_document

# Split document into chunks (max 512 tokens each)
chunks = chunk_document(document_text, max_tokens=512)
```

**Strategy**:
- Preserves paragraph boundaries (split on `\n\n`)
- Falls back to sentence-level splitting if paragraph exceeds limit
- Token estimation: ~4 chars = 1 token (conservative)

### 2. Deduplication (`dedupe.py`)

Detects near-duplicate content using SimHash.

```python
from app.services.knowledge_pipeline import compute_simhash, check_duplicate

# Compute SimHash fingerprint
simhash = compute_simhash(text)

# Check for duplicates in Qdrant
is_dup = await check_duplicate(
    simhash=simhash,
    collection_name="kb_system",
    qdrant=qdrant_client,
    threshold=3,  # Max Hamming distance
    limit=20,     # Check last N documents
)
```

**SimHash Properties**:
- 64-bit hash (default)
- Case-insensitive
- Hamming distance ≤ 3 = considered duplicate
- Word-based tokenization

### 3. Ingestor (`ingestor.py`)

Complete ingestion pipeline with all features.

```python
from app.services.knowledge_pipeline import ingest_chunks

result = await ingest_chunks(
    db=db,
    redis=redis,
    client=client,
    qdrant=qdrant,
    api_key=api_key,
    effective_provider_ids=provider_ids,
    embedding_logical_model="text-embedding-3-small",
    chunks=chunks,
    collection_name="kb_system",
    task_id="crawl_123",
    source_type="crawl",
    tags=["documentation"],
    metadata={"lang": "en", "url": "https://example.com"},
)

# Result: {"total": 10, "ingested": 8, "skipped_duplicate": 2, "skipped_empty": 0, "failed": 0}
```

**Process**:
1. Ensure Qdrant collection exists (lazy init)
2. For each chunk:
   - Compute SimHash
   - Check duplicates
   - Generate embedding via `embed_text`
   - Upsert to Qdrant with payload

## Payload Structure

Each chunk stored in Qdrant includes:

```json
{
  "text": "chunk content here...",
  "task_id": "crawl_123",
  "source_type": "crawl",
  "tags": ["documentation"],
  "simhash": 1234567890,
  "created_at": 1704067200,
  "lang": "en",
  "source_url": "https://example.com/doc"
}
```

## Usage Example

See `example.py` for complete usage patterns.

```python
from app.services.knowledge_pipeline import chunk_document, ingest_chunks

# 1. Chunk document
chunks = chunk_document(document_text, max_tokens=512)

# 2. Ingest with deduplication
result = await ingest_chunks(
    db=db,
    redis=redis,
    client=client,
    qdrant=qdrant,
    api_key=api_key,
    effective_provider_ids=api_key.effective_provider_ids,
    embedding_logical_model="text-embedding-3-small",
    chunks=chunks,
    collection_name="kb_system",
    task_id="task_001",
    source_type="crawl",
    tags=["docs"],
)

print(f"Ingested {result['ingested']}/{result['total']} chunks")
```

## Configuration

Required settings in `settings.py`:

- `qdrant_enabled`: Enable Qdrant integration
- `qdrant_url`: Qdrant HTTP endpoint
- `qdrant_kb_system_collection`: Collection name (default: "kb_system")
- `kb_global_embedding_logical_model`: Embedding model for vectors

## Token Limits

Default: **512 tokens per chunk**

Adjust via `max_tokens` parameter:

```python
# Smaller chunks for precise retrieval
chunks = chunk_document(text, max_tokens=256)

# Larger chunks for broader context
chunks = chunk_document(text, max_tokens=1024)
```

## Deduplication Tuning

Hamming distance threshold controls similarity:

- `threshold=0`: Exact match only
- `threshold=3`: Default, allows minor variations
- `threshold=5`: More permissive, catches paraphrases

```python
is_dup = await check_duplicate(
    simhash=simhash,
    collection_name="kb_system",
    qdrant=qdrant,
    threshold=5,  # More permissive
)
```

## Performance

- **Chunking**: O(n) where n = document length
- **SimHash**: O(w) where w = word count
- **Duplicate check**: O(k) where k = `limit` parameter
- **Ingestion**: O(c × e) where c = chunk count, e = embedding latency

**Optimization Tips**:
- Batch chunk processing (already done)
- Increase `limit` for better dedup accuracy
- Use global embedding model config to avoid per-request setup
- Enable Qdrant's payload indexing for simhash field

## Error Handling

- **Embedding failures**: Logged, skipped, counted in `failed`
- **Duplicate check failures**: Fail-safe, assumes not duplicate
- **Qdrant errors**: Propagated to caller (collection init, upsert)

## Testing

Run tests:

```bash
pytest tests/services/knowledge_pipeline/ -v
```

Or test individual components:

```python
# Test chunker
from app.services.knowledge_pipeline import chunk_document
chunks = chunk_document("test text", max_tokens=100)
assert len(chunks) > 0

# Test SimHash
from app.services.knowledge_pipeline import compute_simhash
hash_val = compute_simhash("test text")
assert hash_val > 0
```
