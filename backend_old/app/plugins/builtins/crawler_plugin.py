import asyncio
from typing import Any, Dict, List, Optional

from app.plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.services.crawler.runner import CrawlConfig, CrawlRunner


class CrawlerPlugin(AgentPlugin):
    """
    网页爬虫插件。
    基于 Playwright 提供网页内容抓取、Markdown 转换和结构化数据提取能力。
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.tools.crawler",
            version="1.0.0",
            description="Provides web crawling capabilities using Playwright.",
            author="Gemini CLI"
        )

    def on_activate(self) -> None:
        self.context.get_logger().info("CrawlerPlugin activated. Ensure Playwright browsers are installed.")

    def get_tools(self) -> List[dict]:
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

    def handle_fetch_web_content(
        self,
        url: str,
        wait_for: str = "networkidle",
        timeout: int = 30000,
        extract_markdown: bool = True,
        extract_tables: bool = True,
        extract_code: bool = True,
        user_agent: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Tool Handler: 执行爬虫任务。
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

        async def _run():
            # CrawlRunner 内部已经处理了 SSRF 校验和异常捕获
            return await CrawlRunner.run(url, cfg)

        try:
            # 在同步环境中运行异步代码
            # 注意：如果当前环境已经是 loop 运行中 (如 uvicorn worker)，这里可能需要调整
            # 但 Agent Task 通常运行在 Celery (多进程/线程模式)，asyncio.run 通常是安全的
            result = asyncio.run(_run())
            
            if result.get("error"):
                logger.warning(f"Crawl finished with error: {result['error']}")
            else:
                logger.info(f"Crawl successful. Title: {result.get('title')}")
                
            return result
            
        except Exception as e:
            logger.exception(f"Unexpected error during crawl: {e}")
            return {
                "url": url,
                "status": 0,
                "error": str(e),
                "text": None
            }
