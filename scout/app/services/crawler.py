import asyncio
import random
import traceback
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
        # 1. [Pre-Flight] Compliance Firewall Check
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
        try:
            async with AsyncWebCrawler(verbose=True) as crawler:
                logger.info(f"Starting browser session for {url}...")
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
                
                # 4. [Post-Flight] Content Safety Check
                # Before we return the loot, we check if it's "radioactive"
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
            return {
                "status": "failed",
                "error": f"Internal Error: {str(e)}",
                "url": url
            }

crawler_service = CrawlerService()