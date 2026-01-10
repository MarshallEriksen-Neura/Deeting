from __future__ import annotations

import pytest

from app.services.knowledge_pipeline.dedupe import _hamming_distance, compute_simhash


def test_compute_simhash_basic():
    """Test basic SimHash computation."""
    text = "This is a test document for SimHash."
    hash_val = compute_simhash(text)
    assert hash_val > 0


def test_compute_simhash_similar_texts():
    """Test that similar texts produce similar hashes."""
    text1 = "The quick brown fox jumps over the lazy dog."
    text2 = "The quick brown fox jumps over the lazy dog!"  # Same text, different punctuation

    hash1 = compute_simhash(text1)
    hash2 = compute_simhash(text2)

    # Hashes should be similar (low Hamming distance)
    distance = _hamming_distance(hash1, hash2)
    assert distance <= 5  # Allow small difference


def test_compute_simhash_different_texts():
    """Test that different texts produce different hashes."""
    text1 = "Machine learning is a subset of artificial intelligence."
    text2 = "Natural language processing deals with text analysis."

    hash1 = compute_simhash(text1)
    hash2 = compute_simhash(text2)

    # Hashes should be different (high Hamming distance)
    distance = _hamming_distance(hash1, hash2)
    assert distance > 10  # Expect significant difference


def test_compute_simhash_empty():
    """Test SimHash with empty text."""
    assert compute_simhash("") == 0
    assert compute_simhash("   ") == 0


def test_compute_simhash_case_insensitive():
    """Test that SimHash is case-insensitive."""
    text1 = "Hello World"
    text2 = "hello world"

    hash1 = compute_simhash(text1)
    hash2 = compute_simhash(text2)

    # Should be identical
    assert hash1 == hash2


def test_hamming_distance():
    """Test Hamming distance calculation."""
    # Binary: 1010 vs 1100 = 2 bits different
    assert _hamming_distance(0b1010, 0b1100) == 2
    # Binary: 1111 vs 0000 = 4 bits different
    assert _hamming_distance(0b1111, 0b0000) == 4
    # Identical
    assert _hamming_distance(0b1010, 0b1010) == 0


@pytest.mark.asyncio
async def test_check_duplicate_no_collection(qdrant_client_mock):
    """Test duplicate check when collection doesn't exist."""
    from app.services.knowledge_pipeline.dedupe import check_duplicate

    # Mock 404 response
    qdrant_client_mock.post.return_value.status_code = 404

    result = await check_duplicate(
        simhash=12345,
        collection_name="test_collection",
        qdrant=qdrant_client_mock,
    )

    # Should return False when collection doesn't exist
    assert result is False
