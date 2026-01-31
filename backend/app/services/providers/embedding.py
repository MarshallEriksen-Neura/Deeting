from typing import List, Optional, Dict, Any
import openai
from app.core.config import settings
from app.services.system import get_cached_embedding_model

class EmbeddingService:
    """
    Service to generate embeddings using OpenAI (or configured provider).
    Supports dynamic configuration injection.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize with optional dynamic config.
        config: {
            "api_key": "sk-...",
            "base_url": "https://...",
            "model": "text-embedding-3-small"
        }
        """
        config = config or {}
        
        # 1. API Key: Config > Settings
        self.api_key = config.get("api_key") or getattr(settings, "OPENAI_API_KEY", None)
        
        # 2. Base URL: Config > Settings
        self.base_url = config.get("base_url") or getattr(settings, "OPENAI_BASE_URL", None)
        
        # 3. Model: Config > Cache > Settings (Default)
        self.model = config.get("model") or getattr(settings, "EMBEDDING_MODEL", "text-embedding-3-small")
        
        self.client = None
        if self.api_key:
            self.client = openai.AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url
            )

    async def _resolve_model(self):
        # If dynamic config was NOT provided, try to use system cached model
        # If dynamic config WAS provided, stick to it
        if not self.client:
             return
             
        # Only check cache if model wasn't explicitly passed in config logic (simplified check)
        # For now, we trust self.model unless it's the default and cache exists
        cached = await get_cached_embedding_model()
        if cached and self.model == "text-embedding-3-small": # heuristic: override default
             self.model = cached

    async def embed_text(self, text: str) -> List[float]:
        """
        Embed a single string.
        """
        if not self.client:
            # Fallback or Mock if no key
            return [0.0] * 1536 
            
        await self._resolve_model()
        
        response = await self.client.embeddings.create(
            input=text,
            model=self.model
        )
        return response.data[0].embedding

    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        Embed multiple strings.
        """
        if not self.client:
            return [[0.0] * 1536 for _ in texts]
            
        await self._resolve_model()
        
        response = await self.client.embeddings.create(
            input=texts,
            model=self.model
        )
        return [data.embedding for data in response.data]