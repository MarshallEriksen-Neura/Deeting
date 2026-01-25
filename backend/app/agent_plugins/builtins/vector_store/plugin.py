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
                    "description": "Add a text chunk to the knowledge base. Use this to store crawled documentation or facts.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "collection_name": {
                                "type": "string",
                                "description": "Target collection (e.g., 'kb_system' or 'kb_user').",
                                "default": settings.QDRANT_KB_SYSTEM_COLLECTION
                            },
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
                    "description": "Semantic search in the knowledge base.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "collection_name": {
                                "type": "string",
                                "default": settings.QDRANT_KB_SYSTEM_COLLECTION
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

    async def handle_add_knowledge_chunk(self, content: str, collection_name: str = settings.QDRANT_KB_SYSTEM_COLLECTION, metadata: Dict = None) -> str:
        """
        Tool Handler: Embed and upsert data into Qdrant.
        """
        if not qdrant_is_configured():
            return "Error: Qdrant is not configured/enabled."

        try:
            embedding_service = EmbeddingService()
            vector = await embedding_service.embed_text(content)
            
            client = get_qdrant_client()
            point_id = str(uuid.uuid4())
            
            payload = metadata or {}
            payload["content"] = content
            
            body = {
                "points": [
                    {
                        "id": point_id,
                        "vector": vector,
                        "payload": payload
                    }
                ]
            }
            
            # Fire and wait
            resp = await client.put(f"/collections/{collection_name}/points", json=body, params={"wait": "true"})
            
            if resp.status_code == 200:
                return f"Successfully added chunk to '{collection_name}'. (ID: {point_id})"
            elif resp.status_code == 404:
                return f"Error: Collection '{collection_name}' does not exist. Please create it first."
            else:
                return f"Error adding chunk: {resp.text}"
                
        except Exception as e:
            logger.exception("VectorStorePlugin add_knowledge_chunk error")
            return f"Error processing request: {str(e)}"

    async def handle_search_knowledge(self, query: str, collection_name: str = settings.QDRANT_KB_SYSTEM_COLLECTION, limit: int = 3) -> str:
        """
        Tool Handler: Search Qdrant.
        """
        if not qdrant_is_configured():
            return "Error: Qdrant is not configured/enabled."

        try:
            embedding_service = EmbeddingService()
            vector = await embedding_service.embed_text(query)
            
            client = get_qdrant_client()
            
            body = {
                "vector": vector,
                "limit": limit,
                "with_payload": True
            }
            
            resp = await client.post(f"/collections/{collection_name}/points/search", json=body)
            
            if resp.status_code != 200:
                if resp.status_code == 404:
                    return f"Error: Collection '{collection_name}' not found."
                return f"Error searching Qdrant: {resp.text}"
            
            results = resp.json().get("result", [])
            
            if not results:
                return f"No results found in '{collection_name}' for query: '{query}'"
            
            # Format results
            formatted_results = []
            for item in results:
                score = item.get("score", 0.0)
                payload = item.get("payload", {})
                content = payload.get("content", "No content")
                meta_str = ", ".join([f"{k}={v}" for k, v in payload.items() if k != "content"])
                formatted_results.append(f"- [Score: {score:.2f}] {content} ({meta_str})")
            
            return "\n".join(formatted_results)

        except Exception as e:
            logger.exception("VectorStorePlugin search_knowledge error")
            return f"Error processing search: {str(e)}"
