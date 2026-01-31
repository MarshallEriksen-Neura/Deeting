from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.models.assistant import AssistantStatus, AssistantVisibility
from app.models.assistant import Assistant, AssistantVersion
from app.models.review import ReviewStatus, ReviewTask
from app.repositories.assistant_repository import AssistantRepository, AssistantVersionRepository
from app.repositories.review_repository import ReviewTaskRepository
from app.services.assistant.assistant_market_service import ASSISTANT_MARKET_ENTITY
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_store import search_points
from app.tasks.assistant import ASSISTANT_COLLECTION_NAME

logger = logging.getLogger(__name__)

OVERSAMPLE_MULTIPLIER = 3
# NOTE: Hard cap to control Qdrant query cost; adjust when retrieval strategy changes.
MAX_LIMIT = 50


class AssistantRetrievalService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.assistant_repo = AssistantRepository(session)
        self.version_repo = AssistantVersionRepository(session)
        self.review_repo = ReviewTaskRepository(session)

    async def search_candidates(self, query: str, limit: int = 3) -> list[dict[str, Any]]:
        if not qdrant_is_configured():
            return []

        try:
            normalized_limit = int(limit or 0)
        except (TypeError, ValueError):
            normalized_limit = 0

        normalized_limit = min(normalized_limit, MAX_LIMIT)
        if normalized_limit <= 0:
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
            query_limit = min(
                max(normalized_limit * OVERSAMPLE_MULTIPLIER, normalized_limit),
                MAX_LIMIT,
            )
            hits = await search_points(
                client,
                collection_name=ASSISTANT_COLLECTION_NAME,
                vector=vector,
                limit=query_limit,
                with_payload=True,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("assistant retrieval failed", exc_info=exc)
            return []

        if not hits:
            return []

        return await self._build_candidates_from_hits(hits, normalized_limit)

    async def _build_candidates_from_hits(
        self,
        hits: list[dict[str, Any]],
        limit: int,
    ) -> list[dict[str, Any]]:
        ordered_ids: list[uuid.UUID] = []
        score_map: dict[uuid.UUID, float] = {}
        for hit in hits:
            assistant_uuid = self._extract_assistant_uuid(hit)
            if not assistant_uuid:
                continue
            if assistant_uuid not in score_map:
                ordered_ids.append(assistant_uuid)
            score = hit.get("score")
            if score is not None and score > score_map.get(assistant_uuid, float("-inf")):
                score_map[assistant_uuid] = float(score)
            if len(ordered_ids) >= limit:
                break

        if not ordered_ids:
            return []

        assistants = await self._fetch_assistants_with_version(ordered_ids)
        if not assistants:
            return []

        review_status_map = await self._fetch_review_status_map(ordered_ids)

        candidates: list[dict[str, Any]] = []
        for assistant_id in ordered_ids:
            row = assistants.get(assistant_id)
            if not row:
                continue
            assistant, version = row
            if not version:
                continue
            if not self._is_public_published(assistant):
                continue
            if assistant.owner_user_id is not None:
                review_status = review_status_map.get(assistant.id)
                if review_status != ReviewStatus.APPROVED.value:
                    continue
            candidates.append(
                {
                    "assistant_id": str(assistant.id),
                    "name": version.name,
                    "summary": assistant.summary,
                    "score": score_map.get(assistant.id, 0.0),
                }
            )
            if len(candidates) >= limit:
                break

        return candidates

    def _extract_assistant_uuid(self, hit: dict[str, Any]) -> uuid.UUID | None:
        payload = hit.get("payload") or {}
        assistant_id = payload.get("assistant_id") or payload.get("uuid") or hit.get("id")
        try:
            return uuid.UUID(str(assistant_id))
        except Exception:
            return None

    def _is_public_published(self, assistant: Assistant) -> bool:
        visibility = (
            assistant.visibility.value
            if isinstance(assistant.visibility, AssistantVisibility)
            else assistant.visibility
        )
        status = (
            assistant.status.value
            if isinstance(assistant.status, AssistantStatus)
            else assistant.status
        )
        return (
            visibility == AssistantVisibility.PUBLIC.value
            and status == AssistantStatus.PUBLISHED.value
        )

    async def _fetch_assistants_with_version(
        self,
        assistant_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, tuple[Assistant, AssistantVersion | None]]:
        if not assistant_ids:
            return {}
        stmt = (
            select(Assistant, AssistantVersion)
            .join(AssistantVersion, Assistant.current_version_id == AssistantVersion.id, isouter=True)
            .where(Assistant.id.in_(assistant_ids))
        )
        result = await self.session.execute(stmt)
        rows = result.all()
        return {row[0].id: (row[0], row[1]) for row in rows}

    async def _fetch_review_status_map(
        self,
        assistant_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, str]:
        if not assistant_ids:
            return {}
        stmt = select(ReviewTask.entity_id, ReviewTask.status).where(
            ReviewTask.entity_type == ASSISTANT_MARKET_ENTITY,
            ReviewTask.entity_id.in_(assistant_ids),
        )
        result = await self.session.execute(stmt)
        rows = result.all()
        return {row[0]: row[1] for row in rows}

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

        visibility = (
            assistant.visibility.value
            if isinstance(assistant.visibility, AssistantVisibility)
            else assistant.visibility
        )
        status = (
            assistant.status.value if isinstance(assistant.status, AssistantStatus) else assistant.status
        )
        if visibility != AssistantVisibility.PUBLIC.value or status != AssistantStatus.PUBLISHED.value:
            return None

        if assistant.owner_user_id is not None:
            # Align with assistant market visibility rule: require approved review for user-owned assistants.
            review = await self.review_repo.get_by_entity(ASSISTANT_MARKET_ENTITY, assistant.id)
            if not review:
                return None
            review_status = review.status.value if isinstance(review.status, ReviewStatus) else review.status
            if review_status != ReviewStatus.APPROVED.value:
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
