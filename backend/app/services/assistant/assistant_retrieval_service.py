from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.assistant_repository import AssistantRepository, AssistantVersionRepository
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_store import search_points
from app.tasks.assistant import ASSISTANT_COLLECTION_NAME

logger = logging.getLogger(__name__)


class AssistantRetrievalService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.assistant_repo = AssistantRepository(session)
        self.version_repo = AssistantVersionRepository(session)

    async def search_candidates(self, query: str, limit: int = 3) -> list[dict[str, Any]]:
        if not qdrant_is_configured():
            return []

        if int(limit or 0) <= 0:
            return []

        query_text = str(query or "").strip()
        if not query_text:
            return []

        try:
            embedding_service = EmbeddingService()
            vector = await embedding_service.embed_text(query_text)
            if not vector:
                return []

            client = get_qdrant_client()
            hits = await search_points(
                client,
                collection_name=ASSISTANT_COLLECTION_NAME,
                vector=vector,
                limit=limit,
                with_payload=True,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("assistant retrieval failed", exc_info=exc)
            return []

        if not hits:
            return []

        candidates: list[dict[str, Any]] = []
        for hit in hits:
            candidate = await self._hit_to_candidate(hit)
            if not candidate:
                continue
            candidates.append(candidate)
            if len(candidates) >= max(1, int(limit or 0)):
                break

        return candidates

    async def _hit_to_candidate(self, hit: dict[str, Any]) -> dict[str, Any] | None:
        payload = hit.get("payload") or {}
        assistant_id = payload.get("assistant_id") or payload.get("uuid") or hit.get("id")
        try:
            assistant_uuid = uuid.UUID(str(assistant_id))
        except Exception:
            return None

        assistant = await self.assistant_repo.get(assistant_uuid)
        if not assistant or not assistant.current_version_id:
            return None

        version = await self.version_repo.get_for_assistant(assistant_uuid, assistant.current_version_id)
        if not version:
            return None

        score = hit.get("score")
        return {
            "assistant_id": str(assistant.id),
            "name": version.name,
            "summary": assistant.summary,
            "score": float(score) if score is not None else 0.0,
        }
