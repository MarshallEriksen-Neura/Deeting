from typing import Any
import httpx
from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.repositories.knowledge_repository import KnowledgeRepository
from app.services.knowledge.crawler_knowledge_service import CrawlerKnowledgeService

class CrawlerPlugin(AgentPlugin):
    """
    Web Crawler Plugin (Remote Scout Adapter).
    Delegates crawl tasks to the 'Deeting Scout' microservice.
    Provides atomic capabilities for single-page inspection and full-site deep dives.
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.tools.crawler",
            version="2.1.0",
            description="Provides web crawling capabilities via Deeting Scout Service.",
            author="Gemini CLI"
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "fetch_web_content",
                    "description": "Fetch and extract content from a SINGLE URL. Use this for quick lookups.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "The target URL to crawl."
                            },
                            "js_mode": {
                                "type": "boolean",
                                "default": True,
                                "description": "Whether to render JavaScript (slower but more accurate)."
                            }
                        },
                        "required": ["url"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "crawl_website",
                    "description": "Recursively crawl a website (Deep Dive) and ingest knowledge into the system memory. Use this when asked to 'learn' or 'read' a documentation site.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "The root URL to start crawling from (e.g. documentation homepage)."
                            },
                            "max_depth": {
                                "type": "integer",
                                "default": 2,
                                "description": "How deep to follow links (1=root only, 2=root+children)."
                            },
                            "max_pages": {
                                "type": "integer",
                                "default": 20,
                                "description": "Maximum number of pages to ingest."
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
        js_mode: bool = True,
        **kwargs
    ) -> dict[str, Any]:
        """
        Tool Handler: Single Page Inspection (Stateless).
        Directly calls Scout API for speed.
        """
        logger = self.context.get_logger()
        scout_url = f"{settings.SCOUT_SERVICE_URL}/v1/scout/inspect"
        
        logger.info(f"Dispatching Scout to: {url}")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    scout_url,
                    json={"url": url, "js_mode": js_mode},
                    timeout=60.0
                )
                response.raise_for_status()
                data = response.json()
                
                if data.get("status") == "failed":
                    return {"status": "error", "error": data.get("error")}
                
                return {
                    "status": "success",
                    "title": data.get("metadata", {}).get("title"),
                    "markdown": data.get("markdown"),
                    "metadata": data.get("metadata")
                }
        except Exception as e:
            return {"status": "error", "error": f"Scout Service Unavailable: {str(e)}"}

    async def handle_crawl_website(
        self,
        url: str,
        max_depth: int = 2,
        max_pages: int = 20,
        **kwargs
    ) -> dict[str, Any]:
        """
        Tool Handler: Deep Dive Ingestion (Stateful).
        Calls internal Service to ensure data persistence.
        """
        logger = self.context.get_logger()
        logger.info(f"Starting Deep Dive Ingestion for: {url}")

        async with AsyncSessionLocal() as session:
            repo = KnowledgeRepository(session)
            service = CrawlerKnowledgeService(repo)
            
            try:
                result = await service.ingest_deep_dive(
                    seed_url=url,
                    max_depth=max_depth,
                    max_pages=max_pages
                )
                return {
                    "status": "success",
                    "message": f"Successfully ingested {len(result.get('ingested_ids', []))} pages.",
                    "details": result
                }
            except Exception as e:
                logger.error(f"Deep Dive failed: {e}")
                return {"status": "error", "error": str(e)}