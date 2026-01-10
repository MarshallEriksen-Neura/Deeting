"""Playwright browser instance management."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any

from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright


class PlaywrightManager:
    """Manages Playwright browser lifecycle."""

    def __init__(self) -> None:
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        """Start Playwright and launch browser."""
        async with self._lock:
            if self._playwright is None:
                self._playwright = await async_playwright().start()
            if self._browser is None:
                self._browser = await self._playwright.chromium.launch(headless=True)

    async def stop(self) -> None:
        """Stop browser and Playwright."""
        async with self._lock:
            if self._browser:
                await self._browser.close()
                self._browser = None
            if self._playwright:
                await self._playwright.stop()
                self._playwright = None

    @asynccontextmanager
    async def new_context(self, **kwargs: Any):
        """Create new browser context with options."""
        if not self._browser:
            await self.start()
        assert self._browser is not None
        context: BrowserContext = await self._browser.new_context(**kwargs)
        try:
            yield context
        finally:
            await context.close()

    @asynccontextmanager
    async def new_page(self, context: BrowserContext | None = None, **kwargs: Any):
        """Create new page in context or default context."""
        if context:
            page: Page = await context.new_page()
            try:
                yield page
            finally:
                await page.close()
        else:
            async with self.new_context(**kwargs) as ctx:
                page = await ctx.new_page()
                try:
                    yield page
                finally:
                    await page.close()


# Singleton instance
_manager: PlaywrightManager | None = None


def get_manager() -> PlaywrightManager:
    """Get singleton PlaywrightManager instance."""
    global _manager
    if _manager is None:
        _manager = PlaywrightManager()
    return _manager
