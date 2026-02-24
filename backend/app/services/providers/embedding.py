from typing import Any

import openai

from app.core.config import settings
from app.services.system import get_cached_embedding_model


# TODO: 重复实现了，当前系统里已经有类似的 EmbeddingService 了，考虑合并
class EmbeddingService:
    """
    Service to generate embeddings using OpenAI (or configured provider).
    Supports dynamic configuration injection.
    """

    def __init__(self, config: dict[str, Any] | None = None):
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
        self.api_key = config.get("api_key") or getattr(
            settings, "OPENAI_API_KEY", None
        )

        # 2. Base URL: Config > Settings
        self.base_url = config.get("base_url") or getattr(
            settings, "OPENAI_BASE_URL", None
        )

        # 3. Model: Config > Cache > Settings (Default)
        explicit_model = config.get("model")
        if isinstance(explicit_model, str):
            explicit_model = explicit_model.strip()
        else:
            explicit_model = None
        self._model_explicit = bool(explicit_model)
        self.model = explicit_model or None
        configured_vector_size = config.get(
            "vector_size", getattr(settings, "EMBEDDING_VECTOR_SIZE", None)
        )
        self._vector_size = self._to_positive_int(configured_vector_size)

        self.client = None
        if self.api_key:
            self.client = openai.AsyncOpenAI(
                api_key=self.api_key, base_url=self.base_url
            )

    @staticmethod
    def _to_positive_int(value: Any) -> int | None:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    async def _resolve_model(self):
        # Explicit model from runtime config should always win.
        if self._model_explicit:
            return

        cached = await get_cached_embedding_model()
        if cached:
            self.model = cached

    def _require_model(self) -> str:
        model = str(self.model or "").strip()
        if not model:
            raise RuntimeError(
                "embedding model is not configured; set it via /admin/settings/embedding"
            )
        return model

    async def embed_text(self, text: str) -> list[float]:
        """
        Embed a single string.
        """
        await self._resolve_model()
        model = self._require_model()

        if not self.client:
            # Fallback or Mock if no key
            vector_size = await self.get_vector_size()
            return [0.0] * vector_size

        response = await self.client.embeddings.create(input=text, model=model)
        embedding = response.data[0].embedding
        if isinstance(embedding, list) and embedding:
            self._vector_size = len(embedding)
        return embedding

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """
        Embed multiple strings.
        """
        await self._resolve_model()
        model = self._require_model()

        if not self.client:
            vector_size = await self.get_vector_size()
            return [[0.0] * vector_size for _ in texts]

        response = await self.client.embeddings.create(input=texts, model=model)
        embeddings = [data.embedding for data in response.data]
        if embeddings and isinstance(embeddings[0], list) and embeddings[0]:
            self._vector_size = len(embeddings[0])
        return embeddings

    async def get_vector_size(self) -> int:
        if self._vector_size:
            return self._vector_size

        await self._resolve_model()
        model = self._require_model()

        if not self.client:
            fallback = self._to_positive_int(getattr(settings, "EMBEDDING_VECTOR_SIZE", None))
            self._vector_size = fallback or 1536
            return self._vector_size

        response = await self.client.embeddings.create(
            input="vector_size_probe",
            model=model,
        )
        embedding = response.data[0].embedding
        size = len(embedding)
        if size <= 0:
            raise RuntimeError("embedding provider returned empty embedding")
        self._vector_size = size
        return size
