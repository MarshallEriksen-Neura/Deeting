from __future__ import annotations

import hashlib
import string
from typing import Any

import httpx


def compute_simhash(text: str, hash_bits: int = 64) -> int:
    """
    Compute SimHash fingerprint for text deduplication.

    SimHash is a locality-sensitive hash that produces similar hashes for similar texts.
    This implementation uses a simple word-based approach.

    Args:
        text: Text to hash
        hash_bits: Number of bits in hash (default 64)

    Returns:
        Integer hash value
    """
    if not text or not text.strip():
        return 0

    # Normalize text
    text = text.lower().strip()

    # Split into tokens (simple whitespace split) and strip punctuation to
    # avoid treating "dog." 与 "dog" 为不同单词
    tokens = []
    for raw in text.split():
        token = raw.strip(string.punctuation)
        if token:
            tokens.append(token)
    if not tokens:
        return 0

    # Initialize bit vector
    vector = [0] * hash_bits

    # Process each token
    for token in tokens:
        # Hash the token using MD5 (fast and good distribution)
        token_hash = hashlib.md5(token.encode("utf-8")).digest()
        # Convert to integer
        hash_int = int.from_bytes(token_hash[:8], byteorder="big")  # Use first 8 bytes

        # Update vector based on hash bits
        for i in range(hash_bits):
            if hash_int & (1 << i):
                vector[i] += 1
            else:
                vector[i] -= 1

    # Compute final hash
    simhash = 0
    for i in range(hash_bits):
        if vector[i] > 0:
            simhash |= 1 << i

    return simhash


def _hamming_distance(hash1: int, hash2: int) -> int:
    """
    Calculate Hamming distance between two hashes.

    Args:
        hash1: First hash
        hash2: Second hash

    Returns:
        Number of differing bits
    """
    xor = hash1 ^ hash2
    # Count set bits (Brian Kernighan's algorithm)
    count = 0
    while xor:
        xor &= xor - 1
        count += 1
    return count


async def check_duplicate(
    simhash: int,
    collection_name: str,
    qdrant: httpx.AsyncClient,
    *,
    threshold: int = 3,
    limit: int = 10,
) -> bool:
    """
    Check if content with similar SimHash exists in Qdrant collection.

    This performs a scroll query to fetch recent documents and compares SimHash values.
    For large collections, consider indexing SimHash in payload for efficient filtering.

    Args:
        simhash: SimHash of new content
        collection_name: Qdrant collection to check
        qdrant: Qdrant HTTP client
        threshold: Maximum Hamming distance to consider duplicate (default 3)
        limit: Number of recent documents to check (default 10)

    Returns:
        True if duplicate found, False otherwise
    """
    if simhash == 0:
        return False

    try:
        # Scroll recent documents with simhash in payload
        resp = await qdrant.post(
            f"/collections/{collection_name}/points/scroll",
            json={
                "limit": limit,
                "with_payload": True,
                "with_vector": False,
                # Filter for documents with simhash field (optional optimization)
                "filter": {"must": [{"key": "simhash", "match": {"except": [None]}}]},
            },
        )

        if resp.status_code == 404:
            # Collection doesn't exist yet
            return False

        resp.raise_for_status()
        data = resp.json()
        points = data.get("result", {}).get("points", [])

        # Check each point's simhash
        for point in points:
            payload = point.get("payload", {})
            existing_hash = payload.get("simhash")
            if existing_hash is not None and isinstance(existing_hash, int):
                distance = _hamming_distance(simhash, existing_hash)
                if distance <= threshold:
                    return True

        return False

    except Exception:
        # On error, assume not duplicate (fail-safe for ingestion)
        return False


__all__ = ["compute_simhash", "check_duplicate"]
