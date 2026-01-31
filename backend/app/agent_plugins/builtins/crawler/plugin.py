from typing import Any
import httpx
from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.config import settings

class CrawlerPlugin(AgentPlugin):
    """
    Web Crawler Plugin (Remote Scout Adapter).
    Delegates crawl tasks to the 'Deeting Scout' microservice.
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.tools.crawler",
            version="2.0.0", # Bumped version for Scout Architecture
            description="Provides web crawling capabilities via Deeting Scout Service.",
            author="Gemini CLI"
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "fetch_web_content",
                    "description": "Fetch and extract content from a URL using the Scout service. Returns clean Markdown.",
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
            }
        ]

    async def handle_fetch_web_content(
        self,
        url: str,
        js_mode: bool = True,
        **kwargs # Ignore legacy args
    ) -> dict[str, Any]:
        """
        Tool Handler: Delegate to Scout Service.
        """
        logger = self.context.get_logger()
        scout_url = f"{settings.SCOUT_SERVICE_URL}/v1/scout/inspect"
        
        logger.info(f"Dispatching Scout to: {url} (via {scout_url})")

        payload = {
            "url": url,
            "js_mode": js_mode
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    scout_url,
                    json=payload,
                    timeout=120.0 # Crawling can be slow
                )
                response.raise_for_status()
                data = response.json()
                
                if data.get("status") == "failed":
                    logger.warning(f"Scout reported failure: {data.get('error')}")
                    return {
                        "status": "error",
                        "error": data.get("error"),
                        "markdown": ""
                    }
                
                logger.info(f"Scout returned success. {data.get('metadata', {})}")
                return {
                    "status": "success",
                    "title": "Scout Report",
                    "text": data.get("markdown", "")[:200] + "...", # Legacy compat
                    "markdown": data.get("markdown"),
                    "metadata": data.get("metadata")
                }

        except Exception as e:
            logger.error(f"Failed to contact Scout service: {e}")
            return {
                "status": "error", 
                "error": f"Scout Service Unavailable: {str(e)}"
            }
