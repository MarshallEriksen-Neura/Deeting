"""Playwright-based web crawler service for content extraction."""

from __future__ import annotations

from .browser import PlaywrightManager
from .extractor import extract_code_blocks, extract_main_content, html_to_markdown
from .runner import CrawlRunner

__all__ = [
    "PlaywrightManager",
    "extract_main_content",
    "extract_code_blocks",
    "html_to_markdown",
    "CrawlRunner",
]
