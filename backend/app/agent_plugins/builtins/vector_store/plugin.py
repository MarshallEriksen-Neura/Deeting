from typing import Any, List, Dict, Optional
import uuid
import logging
from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.core.config import settings
from app.services.providers.embedding import EmbeddingService

logger = logging.getLogger(__name__)

class VectorStorePlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/vector_store",
            version="1.0.0",
            description="Manage Vector Knowledge Base (Qdrant). Add, search, and manage collections.",
            author="System"
        )

    def get_tools(self) -> List[Any]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "add_knowledge_chunk",
                    "description": "Add a text chunk to your PERSONAL long-term memory. Use this to remember facts, preferences, or notes for the future.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "The text content to store."
                            },
                            "metadata": {
                                "type": "object",
                                "description": "Optional metadata (e.g., source_url, title, timestamp).",
                                "default": {}
                            }
                        },
                        "required": ["content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "search_knowledge",
                    "description": "Semantic search in the knowledge base (Personal Memory or System Knowledge).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "scope": {
                                "type": "string",
                                "description": "Search scope: 'personal' (your memory) or 'system' (platform documentation/rules).",
                                "enum": ["personal", "system"],
                                "default": "personal"
                            },
                            "query": {
                                "type": "string", 
                                "description": "The search query."
                            },
                            "limit": {
                                "type": "integer",
                                "default": 3
                            }
                        },
                        "required": ["query"]
                    }
                }
            }
        ]

    async def handle_add_knowledge_chunk(self, content: str, metadata: Dict = None) -> str:
        """
        Tool Handler: Embed and upsert data into User's Private Qdrant Collection.
        """
        if not qdrant_is_configured():
            return "Error: Qdrant is not configured/enabled."

        try:
            # Securely upsert into the user's private collection via context memory
            point_id = await self.context.memory.upsert(content, payload=metadata)
            return f"Successfully remembered. (ID: {point_id})"
                
        except Exception as e:
            logger.exception("VectorStorePlugin add_knowledge_chunk error")
            return f"Error processing request: {str(e)}"

    async def handle_search_knowledge(self, query: str, scope: str = "personal", limit: int = 3) -> str:
        """
        Tool Handler: Search Qdrant (Personal or System).
        """
        if not qdrant_is_configured():
            return "Error: Qdrant is not configured/enabled."

        try:
            results = []
            
            if scope == "personal":
                # Search User Memory
                items = await self.context.memory.search(query, limit=limit)
                # Convert to uniform format
                for item in items:
                    results.append({
                        "score": item["score"],
                        "payload": item["payload"]
                    })
            else:
                # Search System Knowledge
                embedding_service = EmbeddingService()
                vector = await embedding_service.embed_text(query)
                client = get_qdrant_client()
                
                body = {
                    "vector": vector,
                    "limit": limit,
                    "with_payload": True
                }
                
                resp = await client.post(f"/collections/{settings.QDRANT_KB_SYSTEM_COLLECTION}/points/search", json=body)
                
                if resp.status_code == 404:
                    return "System knowledge base not found."
                elif resp.status_code != 200:
                    return f"Error searching system KB: {resp.text}"
                
                api_results = resp.json().get("result", [])
                results = api_results # API result format is compatible enough (has score and payload)

            if not results:
                return f"No results found in {scope} memory for query: '{query}'"
            
            # Format results
            formatted_results = []
            for item in results:
                score = item.get("score", 0.0)
                payload = item.get("payload", {})
                content = payload.get("content", "No content")
                
                # Filter out internal fields for display
                meta_str = ", ".join([f"{k}={v}" for k, v in payload.items() if k not in ["content", "user_id", "plugin_id", "embedding_model"]])
                formatted_results.append(f"- [Score: {score:.2f}] {content} ({meta_str})")
            
            return "\n".join(formatted_results)

        except Exception as e:
            logger.exception("VectorStorePlugin search_knowledge error")
            return f"Error processing search: {str(e)}"
