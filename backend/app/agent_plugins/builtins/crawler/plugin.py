from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata

from .browser import get_manager
from .runner import CrawlConfig, CrawlRunner


class CrawlerPlugin(AgentPlugin):
    """
    Web Crawler Plugin.
    Provides capabilities to fetch web content, convert to Markdown, and extract structured data using Playwright.
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.tools.crawler",
            version="1.0.0",
            description="Provides web crawling capabilities using Playwright.",
            author="Gemini CLI"
        )

    async def on_activate(self) -> None:
        """
        Initialize Playwright when plugin is activated.
        """
        logger = self.context.get_logger()
        logger.info("CrawlerPlugin activating. Launching Playwright browser...")
        manager = get_manager()
        await manager.start()
        logger.info("CrawlerPlugin activated and browser launched.")

    async def on_deactivate(self) -> None:
        """
        Stop Playwright when plugin is deactivated.
        """
        logger = self.context.get_logger()
        logger.info("CrawlerPlugin deactivating. Stopping Playwright browser...")
        manager = get_manager()
        await manager.stop()
        logger.info("CrawlerPlugin deactivated.")

    def get_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "fetch_web_content",
                    "description": "Fetch and extract content from a URL. Returns text, markdown, and structured data.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "The target URL to crawl."
                            },
                            "wait_for": {
                                "type": "string",
                                "enum": ["load", "domcontentloaded", "networkidle"],
                                "default": "networkidle",
                                "description": "Wait strategy for page loading."
                            },
                            "timeout": {
                                "type": "integer",
                                "default": 30000,
                                "description": "Timeout in milliseconds."
                            },
                            "extract_markdown": {
                                "type": "boolean",
                                "default": True,
                                "description": "Whether to convert HTML to Markdown."
                            },
                            "extract_tables": {
                                "type": "boolean",
                                "default": True,
                                "description": "Whether to extract tables."
                            },
                            "extract_code": {
                                "type": "boolean",
                                "default": True,
                                "description": "Whether to extract code blocks."
                            },
                            "user_agent": {
                                "type": "string",
                                "description": "Custom User-Agent string."
                            }
                        },
                        "required": ["url"]
                    }
                }
            }
        ]

    async def handle_fetch_web_content(
        self,
        url: str,
        wait_for: str = "networkidle",
        timeout: int = 30000,
        extract_markdown: bool = True,
        extract_tables: bool = True,
        extract_code: bool = True,
        user_agent: str | None = None
    ) -> dict[str, Any]:
        """
        Tool Handler: Execute crawl task.
        """
        logger = self.context.get_logger()
        logger.info(f"Crawling URL: {url}")

        cfg = CrawlConfig(
            wait_for=wait_for,
            timeout=timeout,
            extract_markdown=extract_markdown,
            extract_tables=extract_tables,
            extract_code=extract_code,
            user_agent=user_agent
        )

        result = await CrawlRunner.run(url, cfg)

        if result.get("error"):
            logger.warning(f"Crawl finished with error: {result['error']}")
        else:
            logger.info(f"Crawl successful. Title: {result.get('title')}")

        return result
