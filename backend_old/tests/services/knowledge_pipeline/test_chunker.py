from __future__ import annotations

import pytest

from app.services.knowledge_pipeline.chunker import chunk_document


def test_chunk_document_simple():
    """Test basic chunking with small text."""
    text = "This is a test. This is only a test."
    chunks = chunk_document(text, max_tokens=100)
    assert len(chunks) == 1
    assert "test" in chunks[0]


def test_chunk_document_paragraphs():
    """Test chunking preserves paragraph boundaries."""
    text = """First paragraph here.

Second paragraph here.

Third paragraph here."""
    chunks = chunk_document(text, max_tokens=100)
    assert len(chunks) == 3
    assert "First" in chunks[0]
    assert "Second" in chunks[1]
    assert "Third" in chunks[2]


def test_chunk_document_large_paragraph():
    """Test chunking splits large paragraphs by sentences."""
    # Create a paragraph with multiple sentences
    text = "First sentence. " * 50 + "Last sentence."
    chunks = chunk_document(text, max_tokens=50)
    # Should split into multiple chunks
    assert len(chunks) > 1
    # Each chunk should be within limit (rough check: 4 chars = 1 token)
    for chunk in chunks:
        assert len(chunk) <= 50 * 4 + 100  # Some tolerance


def test_chunk_document_empty():
    """Test chunking empty text."""
    assert chunk_document("") == []
    assert chunk_document("   ") == []


def test_chunk_document_chinese():
    """Test chunking with Chinese text."""
    text = "这是第一段。\n\n这是第二段。\n\n这是第三段。"
    chunks = chunk_document(text, max_tokens=100)
    assert len(chunks) == 3


def test_chunk_document_mixed():
    """Test chunking with mixed English and Chinese."""
    text = """Hello world.

你好世界。

Mixed content here with both English and 中文."""
    chunks = chunk_document(text, max_tokens=100)
    assert len(chunks) == 3
    assert "Hello" in chunks[0]
    assert "你好" in chunks[1]
    assert "Mixed" in chunks[2]
