import asyncio
import random
from crawl4ai import AsyncWebCrawler
from loguru import logger
from typing import Optional, Dict, Any

from app.core.compliance import compliance_manager

class CrawlerService:
    """
    Scout's Tactical Recon Unit.
    Integrated with Compliance Engine and Anti-Scraping Evasion.
    """
    
    async def inspect_url(self, url: str, js_mode: bool = True) -> Dict[str, Any]:
        # 1. Compliance Firewall Check
        if not await compliance_manager.is_safe_to_crawl(url):
            logger.error(f"⚠️  Mission Aborted: Target {url} violated safety/compliance rules.")
            return {
                "status": "failed",
                "error": "Security/Compliance Violation: Target is blacklisted.",
                "url": url
            }

        logger.info(f"Scout dispatching to: {url}")
        
        # 2. Human Behavior Simulation (Jitter)
        # Random delay between 1.5s to 4.5s to avoid burst detection
        delay = random.uniform(1.5, 4.5)
        logger.debug(f"Applying stealth jitter: {delay:.2f}s")
        await asyncio.sleep(delay)

        # 3. Execution (Stealth Mode)
        async with AsyncWebCrawler(verbose=True) as crawler:
            try:
                result = await crawler.arun(
                    url=url,
                    bypass_cache=True,
                    # Magic=True enables Playwright Stealth, changing Navigator props, 
                    # masking Automation features, and randomizing Canvas fingerprints.
                    magic=True,
                    
                    # Optional: Add simple user simulation steps if Crawl4AI allows hooks in future versions
                    # For now, 'magic' handles the browser fingerprinting.
                )
                
                if not result.success:
                    logger.error(f"Mission failed for {url}: {result.error_message}")
                    return {
                        "status": "failed",
                        "error": result.error_message,
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
                return {
                    "status": "failed",
                    "error": str(e),
                    "url": url
                }

crawler_service = CrawlerService()