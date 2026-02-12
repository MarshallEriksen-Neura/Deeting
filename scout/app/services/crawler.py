import asyncio
import random
import traceback
from crawl4ai import AsyncWebCrawler
from loguru import logger
from typing import Optional, Dict, Any

from app.core.compliance import compliance_manager
from app.core.config import settings


class CrawlerService:
    """
    Scout's Tactical Recon Unit.
    Integrated with Compliance Engine and Anti-Scraping Evasion.

    Maintains a persistent browser instance that is reused across requests
    to avoid the overhead of launching/closing Chromium on every call.
    """

    def __init__(self):
        self._semaphore: asyncio.Semaphore | None = None
        self._crawler: AsyncWebCrawler | None = None
        self._lock = asyncio.Lock()

    @property
    def semaphore(self) -> asyncio.Semaphore:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_CRAWLS)
        return self._semaphore

    async def _get_crawler(self) -> AsyncWebCrawler:
        """Return a shared, long-lived browser instance (lazy-init, thread-safe)."""
        if self._crawler is not None and self._crawler.ready:
            return self._crawler

        async with self._lock:
            # Double-check after acquiring the lock
            if self._crawler is not None and self._crawler.ready:
                return self._crawler

            logger.info("Initializing persistent browser instance...")
            crawler = AsyncWebCrawler(verbose=True)
            await crawler.start()
            self._crawler = crawler
            logger.info("Persistent browser instance ready.")
            return self._crawler

    async def close(self):
        """Shutdown the persistent browser (call on app shutdown)."""
        if self._crawler is not None:
            await self._crawler.close()
            self._crawler = None
            logger.info("Persistent browser instance closed.")

    async def inspect_url(self, url: str, js_mode: bool = True) -> Dict[str, Any]:
        # 1. [Pre-Flight] Compliance Firewall Check
        if not await compliance_manager.is_safe_to_crawl(url):
            logger.error(f"⚠️  Mission Aborted: Target {url} violated safety/compliance rules.")
            return {
                "status": "failed",
                "error": "Security/Compliance Violation: Target is blacklisted.",
                "url": url
            }

        logger.info(f"Scout dispatching to: {url}")

        # 2. Concurrency gate – prevent too many concurrent crawls
        async with self.semaphore:
            return await self._crawl(url, js_mode)

    async def _crawl(self, url: str, js_mode: bool) -> Dict[str, Any]:
        # 3. Human Behavior Simulation (Jitter)
        delay = random.uniform(1.5, 4.5)
        logger.debug(f"Applying stealth jitter: {delay:.2f}s")
        await asyncio.sleep(delay)

        # 4. Execution – reuse persistent browser
        try:
            crawler = await self._get_crawler()
            logger.info(f"Reusing browser session for {url}...")
            result = await crawler.arun(
                url=url,
                bypass_cache=True,
                magic=True,
            )

            if not result.success:
                logger.error(f"Mission failed for {url}: {result.error_message}")
                return {
                    "status": "failed",
                    "error": result.error_message,
                    "url": url
                }

            # 5. [Post-Flight] Content Safety Check
            if not compliance_manager.is_content_safe(result.markdown):
                logger.error(f"☢️  Content Rejected: Sensitive content detected in {url}")
                return {
                    "status": "failed",
                    "error": "Security/Compliance Violation: Sensitive content detected.",
                    "url": url
                }

            logger.info(f"Mission success. Extracted {len(result.markdown)} chars.")

            return {
                "status": "success",
                "url": url,
                "title": result.metadata.get("title", "Untitled"),
                "markdown": result.markdown,
                "metadata": result.metadata,
                "links": result.links
            }
        except Exception as e:
            logger.error(f"Critical crawler error: {e}")
            traceback.print_exc()
            # Reset the browser on crash so the next request gets a fresh one
            try:
                await self.close()
            except Exception:
                pass
            return {
                "status": "failed",
                "error": f"Internal Error: {str(e)}",
                "url": url
            }


crawler_service = CrawlerService()
