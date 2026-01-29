import uuid
from typing import Any, List, Optional
from loguru import logger
import httpx
from app.core.config import settings
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.services.providers.embedding import EmbeddingService
from app.models.agent_plugin import AgentPlugin
from app.storage.qdrant_kb_collections import (
    get_kb_candidates_collection_name,
    get_kb_system_collection_name,
    get_tool_system_collection_name,
)
from app.storage.qdrant_kb_store import ensure_collection_vector_size

# Constants for Collection Names
COLLECTION_PLUGIN_MARKETPLACE = "plugin_marketplace"
COLLECTION_SEMANTIC_CACHE = "semantic_cache"
COLLECTION_KB_SYSTEM = get_kb_system_collection_name()
COLLECTION_KB_CANDIDATES = get_kb_candidates_collection_name()
COLLECTION_SYS_TOOL_INDEX = get_tool_system_collection_name()

# Constants for System Scopes
SCOPE_SYSTEM_PUBLIC = "SYSTEM_PUBLIC"
SCOPE_SYSTEM_INTERNAL = "SYSTEM_INTERNAL"
SCOPE_USER_PRIVATE = "USER_PRIVATE"

class SystemQdrantService:
    """
    System-level Qdrant Service (The 'OS Kernel' for Vectors).
    
    Responsibilities:
    1. Manage Global Collections (Marketplace, Cache, Memory, Tools).
    2. Execute 'Root' level queries (Discovery, Cache Lookup, Tool Retrieval).
    3. Maintain Data Integrity (Index creation).
    """

    def __init__(self):
        self._embedding_service = EmbeddingService()

    @property
    def client(self) -> httpx.AsyncClient:
        return get_qdrant_client()

    async def initialize_collections(self) -> None:
        """
        Idempotent initialization of required collections.
        Should be called at startup.
        """
        if not qdrant_is_configured():
            logger.warning("Qdrant not configured, skipping collection initialization.")
            return

        # We use the raw Qdrant REST API via httpx for full control
        # 1. Plugin Marketplace
        await self._ensure_collection(COLLECTION_PLUGIN_MARKETPLACE, vector_size=1536)
        
        # 2. Semantic Cache
        await self._ensure_collection(COLLECTION_SEMANTIC_CACHE, vector_size=1536)

        # 3. System KB（平台维护，用户不可写）
        await self._ensure_collection(COLLECTION_KB_SYSTEM, vector_size=1536)

        # 4. Candidate KB（候选知识暂存）
        await self._ensure_collection(COLLECTION_KB_CANDIDATES, vector_size=1536)

        # 5. System Tool Index (Shared, ReadOnly for users)
        await self._ensure_collection(COLLECTION_SYS_TOOL_INDEX, vector_size=1536)

    async def _ensure_collection(self, name: str, vector_size: int) -> None:
        """Create collection if not exists."""
        await ensure_collection_vector_size(
            self.client,
            collection_name=name,
            vector_size=vector_size,
        )

    async def sync_plugin_to_marketplace(self, plugin: AgentPlugin) -> None:
        """
        Upsert a plugin's metadata into the marketplace collection.
        This allows 'Discovery' via natural language.
        """
        if not qdrant_is_configured():
            return

        # Construct text for embedding: "Name: weather. Description: Get weather info..."
        text_to_embed = f"Name: {plugin.display_name or plugin.name}. Description: {plugin.description or ''}. Capabilities: {plugin.capabilities or []}"
        vector = await self._embedding_service.embed_text(text_to_embed)

        payload = {
            "plugin_id": str(plugin.id),
            "name": plugin.name,
            "display_name": plugin.display_name,
            "owner_id": str(plugin.owner_id) if plugin.owner_id else None,
            "visibility": plugin.visibility,
            "is_system": plugin.is_system,
            "is_approved": plugin.is_approved,
            "capabilities": plugin.capabilities
        }

        body = {
            "points": [
                {
                    "id": str(plugin.id),
                    "vector": vector,
                    "payload": payload
                }
            ]
        }
        
        await self.client.put(
            f"/collections/{COLLECTION_PLUGIN_MARKETPLACE}/points",
            json=body,
            params={"wait": "true"}
        )

    async def search_plugins(self, query: str, user_id: uuid.UUID, limit: int = 5) -> List[dict]:
        """
        Discover plugins using natural language.
        Applies strict visibility filters:
        - System Plugins
        - Public Approved Plugins
        - My Private Plugins
        """
        if not qdrant_is_configured():
            return []

        vector = await self._embedding_service.embed_text(query)

        # Filter Logic:
        # (is_system=True) OR (visibility='PUBLIC' AND is_approved=True) OR (owner_id=user_id)
        
        filter_payload = {
            "should": [
                {"key": "is_system", "match": {"value": True}},
                {
                    "must": [
                        {"key": "visibility", "match": {"value": "PUBLIC"}},
                        {"key": "is_approved", "match": {"value": True}}
                    ]
                },
                {"key": "owner_id", "match": {"value": str(user_id)}}
            ]
        }

        body = {
            "vector": vector,
            "filter": filter_payload,
            "limit": limit,
            "with_payload": True
        }

        resp = await self.client.post(
            f"/collections/{COLLECTION_PLUGIN_MARKETPLACE}/points/search",
            json=body
        )
        resp.raise_for_status()
        
        results = resp.json().get("result", [])
        return [
            {
                "plugin_id": item["payload"]["plugin_id"],
                "name": item["payload"]["name"],
                "score": item["score"],
                "display_name": item["payload"].get("display_name"),
                "description": item["payload"].get("description") # Can fetch full desc from DB if needed
            }
            for item in results
        ]

    async def semantic_cache_lookup(self, query: str, threshold: float = 0.95) -> Optional[str]:
        """
        Check if we have a semantic cache hit for the query.
        Returns the cached response text or None.
        """
        if not qdrant_is_configured():
            return None

        vector = await self._embedding_service.embed_text(query)
        
        body = {
            "vector": vector,
            "limit": 1,
            "with_payload": True,
            "score_threshold": threshold
        }

        resp = await self.client.post(
            f"/collections/{COLLECTION_SEMANTIC_CACHE}/points/search",
            json=body
        )
        
        results = resp.json().get("result", [])
        if not results:
            return None
            
        return results[0]["payload"].get("response")

    async def semantic_cache_save(self, query: str, response: str) -> None:
        """
        Save a query-response pair to the semantic cache.
        """
        if not qdrant_is_configured():
            return

        vector = await self._embedding_service.embed_text(query)
        point_id = str(uuid.uuid4())
        
        payload = {
            "query": query,
            "response": response,
            "timestamp": "TODO_TIMESTAMP" 
        }

        body = {
            "points": [
                {
                    "id": point_id,
                    "vector": vector,
                    "payload": payload
                }
            ]
        }
        
        # Fire and forget (don't wait)
        await self.client.put(
            f"/collections/{COLLECTION_SEMANTIC_CACHE}/points",
            json=body,
            params={"wait": "false"}
        )

# Singleton
system_qdrant = SystemQdrantService()
