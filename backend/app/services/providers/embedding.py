from typing import List
import openai
from app.core.config import settings

class EmbeddingService:
    """
    Service to generate embeddings using OpenAI (or configured provider).
    """
    
    def __init__(self):
        self.api_key = getattr(settings, "OPENAI_API_KEY", None)
        self.base_url = getattr(settings, "OPENAI_BASE_URL", None)
        self.model = getattr(settings, "EMBEDDING_MODEL", "text-embedding-3-small")
        
        self.client = None
        if self.api_key:
            self.client = openai.AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url
            )

    async def embed_text(self, text: str) -> List[float]:
        """
        Embed a single string.
        """
        if not self.client:
            # Fallback or Mock if no key
            return [0.0] * 1536 
            
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
            
        response = await self.client.embeddings.create(
            input=texts,
            model=self.model
        )
        return [data.embedding for data in response.data]
