from __future__ import annotations

import re


def _estimate_tokens(text: str) -> int:
    """
    Estimate token count using simple heuristic: ~4 chars = 1 token for English/Chinese mix.
    This is a conservative estimate to stay within token limits.
    """
    return len(text) // 4 + 1


def _split_by_paragraphs(text: str) -> list[str]:
    """
    Split text into paragraphs, preserving structure.
    Uses double newline as paragraph separator.
    """
    # Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Split on double newlines or more
    paragraphs = re.split(r"\n{2,}", text)
    # Clean and filter empty
    return [p.strip() for p in paragraphs if p.strip()]


def _split_by_sentences(text: str) -> list[str]:
    """
    Split text into sentences for finer-grained chunking.
    Handles both English and Chinese punctuation.
    """
    # Split on sentence-ending punctuation
    sentences = re.split(r"([.!?。!?]+[\s\n]*)", text)
    # Recombine sentence with its punctuation
    result: list[str] = []
    for i in range(0, len(sentences) - 1, 2):
        sent = sentences[i] + (sentences[i + 1] if i + 1 < len(sentences) else "")
        sent = sent.strip()
        if sent:
            result.append(sent)
    # Handle last sentence if no punctuation
    if len(sentences) % 2 == 1:
        last = sentences[-1].strip()
        if last:
            result.append(last)
    return result


def chunk_document(text: str, max_tokens: int = 512) -> list[str]:
    """
    Chunk document using semantic boundaries (paragraphs/sentences) with token limits.

    Strategy:
    1. Split by paragraphs first (preserve semantic structure)
    2. If paragraph exceeds max_tokens, split by sentences
    3. If sentence still exceeds, truncate (rare edge case)

    Args:
        text: Document text to chunk
        max_tokens: Maximum tokens per chunk (default 512)

    Returns:
        List of text chunks, each <= max_tokens
    """
    if not text or not text.strip():
        return []

    chunks: list[str] = []
    paragraphs = _split_by_paragraphs(text)

    for para in paragraphs:
        para_tokens = _estimate_tokens(para)

        if para_tokens <= max_tokens:
            # Paragraph fits within limit, add as-is
            chunks.append(para)
        else:
            # Paragraph too large, split by sentences
            sentences = _split_by_sentences(para)
            current_chunk: list[str] = []
            current_tokens = 0

            for sent in sentences:
                sent_tokens = _estimate_tokens(sent)

                # If single sentence exceeds max, truncate it (rare edge case)
                if sent_tokens > max_tokens:
                    # Truncate to fit, preserve first part
                    char_limit = max_tokens * 4  # Reverse the 4 chars = 1 token heuristic
                    truncated = sent[:char_limit].strip()
                    if current_chunk:
                        chunks.append(" ".join(current_chunk))
                        current_chunk = []
                        current_tokens = 0
                    chunks.append(truncated)
                    continue

                # Check if adding this sentence exceeds limit
                if current_tokens + sent_tokens > max_tokens:
                    # Flush current chunk
                    if current_chunk:
                        chunks.append(" ".join(current_chunk))
                    current_chunk = [sent]
                    current_tokens = sent_tokens
                else:
                    # Add to current chunk
                    current_chunk.append(sent)
                    current_tokens += sent_tokens

            # Flush remaining
            if current_chunk:
                chunks.append(" ".join(current_chunk))

    return chunks


__all__ = ["chunk_document"]
