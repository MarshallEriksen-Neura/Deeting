"""Crawler runner with SSRF protection."""

from __future__ import annotations

import asyncio
import ipaddress
import re
from typing import Any
from urllib.parse import urlparse

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from .browser import get_manager
from .extractor import extract_code_blocks, extract_main_content, extract_tables, html_to_markdown


class SSRFError(ValueError):
    """Raised when URL fails SSRF validation."""


class CrawlConfig:
    """Configuration for crawler."""

    def __init__(
        self,
        wait_for: str = "networkidle",
        timeout: int = 30000,
        extract_markdown: bool = True,
        extract_tables: bool = True,
        extract_code: bool = True,
        user_agent: str | None = None,
        max_scrolls: int = 0, # Added max_scrolls
    ) -> None:
        self.wait_for = wait_for
        self.timeout = timeout
        self.extract_markdown = extract_markdown
        self.extract_tables = extract_tables
        self.extract_code = extract_code
        self.user_agent = user_agent
        self.max_scrolls = max_scrolls


class CrawlRunner:
    """Executes web crawling with content extraction."""

    # Private IP ranges for SSRF protection
    PRIVATE_IP_RANGES = [
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("127.0.0.0/8"),
        ipaddress.ip_network("169.254.0.0/16"),
        ipaddress.ip_network("::1/128"),
        ipaddress.ip_network("fc00::/7"),
        ipaddress.ip_network("fe80::/10"),
    ]

    BLOCKED_PORTS = {22, 23, 25, 3306, 5432, 6379, 27017}

    @classmethod
    def validate_url(cls, url: str) -> None:
        """
        Validate URL against SSRF attacks.

        Raises SSRFError if URL is unsafe.
        """
        try:
            parsed = urlparse(url)
        except Exception as e:
            raise SSRFError(f"Invalid URL format: {e}") from e

        # Must have scheme
        if parsed.scheme not in ("http", "https"):
            raise SSRFError(f"Invalid scheme: {parsed.scheme}")

        # Must have hostname
        if not parsed.hostname:
            raise SSRFError("Missing hostname")

        # Block localhost variants
        localhost_patterns = [
            r"^localhost$",
            r"^127\.",
            r"^0\.0\.0\.0$",
            r"^::1$",
            r"^\[::1\]$",
        ]
        hostname_lower = parsed.hostname.lower()
        for pattern in localhost_patterns:
            if re.match(pattern, hostname_lower):
                raise SSRFError(f"Localhost not allowed: {parsed.hostname}")

        # Try to resolve IP
        try:
            ip = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            # Hostname is domain name, allow it (DNS will resolve)
            pass
        else:
            # Check if IP is in private range
            for network in cls.PRIVATE_IP_RANGES:
                if ip in network:
                    raise SSRFError(f"Private IP not allowed: {parsed.hostname}")

        # Check port
        port = parsed.port
        if port and port in cls.BLOCKED_PORTS:
            raise SSRFError(f"Blocked port: {port}")

    @classmethod
    async def run(cls, url: str, config: CrawlConfig | None = None) -> dict[str, Any]:
        """
        Crawl URL and extract content.

        Returns dict with keys:
            - url: str
            - title: str
            - text: str (main content)
            - markdown: str | None
            - code_blocks: list[dict] | None
            - tables: list[dict] | None
            - status: int
            - error: str | None
        """
        if config is None:
            config = CrawlConfig()

        # SSRF validation
        cls.validate_url(url)

        manager = get_manager()

        try:
            context_options: dict[str, Any] = {}
            if config.user_agent:
                context_options["user_agent"] = config.user_agent

            async with manager.new_context(**context_options) as context:
                async with manager.new_page(context) as page:
                    # Navigate to URL
                    response = await page.goto(url, wait_until=config.wait_for, timeout=config.timeout)

                    if not response:
                        return {
                            "url": url,
                            "title": "",
                            "text": "",
                            "markdown": None,
                            "code_blocks": None,
                            "tables": None,
                            "status": 0,
                            "error": "No response received",
                        }

                    status = response.status

                    # Handle Infinite Scroll
                    if config.max_scrolls > 0:
                        await cls._scroll_to_bottom(page, config.max_scrolls)

                    # Get page title
                    title = await page.title()

                    # Get HTML content
                    html = await page.content()

                    # Extract main content
                    text = extract_main_content(html)

                    # Optional extractions
                    markdown = html_to_markdown(html) if config.extract_markdown else None
                    code_blocks = extract_code_blocks(html) if config.extract_code else None
                    tables = extract_tables(html) if config.extract_tables else None

                    return {
                        "url": url,
                        "title": title,
                        "text": text,
                        "markdown": markdown,
                        "code_blocks": code_blocks,
                        "tables": tables,
                        "status": status,
                        "error": None,
                    }

        except SSRFError:
            raise
        except PlaywrightTimeoutError as e:
            return {
                "url": url,
                "title": "",
                "text": "",
                "markdown": None,
                "code_blocks": None,
                "tables": None,
                "status": 0,
                "error": f"Timeout: {e!s}",
            }
        except Exception as e:
            return {
                "url": url,
                "title": "",
                "text": "",
                "markdown": None,
                "code_blocks": None,
                "tables": None,
                "status": 0,
                "error": str(e),
            }

    @staticmethod
    async def _scroll_to_bottom(page: Any, max_scrolls: int) -> None:
        """
        Scroll the page to trigger dynamic content loading.
        """
        for _ in range(max_scrolls):
            # Scroll down
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            # Wait for content load (heuristic)
            await page.wait_for_timeout(1000) # Wait 1s between scrolls