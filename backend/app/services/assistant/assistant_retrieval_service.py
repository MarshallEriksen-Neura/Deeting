from __future__ import annotations

import logging
import random
import time
import uuid
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant, AssistantStatus, AssistantVersion, AssistantVisibility
from app.models.assistant_routing import AssistantRoutingState
from app.models.review import ReviewStatus, ReviewTask
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.assistant_repository import (
    AssistantRepository,
    AssistantVersionRepository,
)
from app.repositories.assistant_routing_repository import AssistantRoutingRepository
from app.repositories.review_repository import ReviewTaskRepository
from app.services.assistant.constants import ASSISTANT_MARKET_ENTITY
from app.services.assistant.default_assistant_service import DefaultAssistantService
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
        self.routing_repo = AssistantRoutingRepository(session)

    async def search_candidates(
        self, query: str, limit: int = 3
    ) -> list[dict[str, Any]]:
        if not qdrant_is_configured():
            return await self._fallback_default_assistant(reason="qdrant_disabled")

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
            return await self._fallback_default_assistant(reason="qdrant_error")

        if not hits:
            return []

        return await self._build_candidates_from_hits(hits, normalized_limit)

    async def _build_candidates_from_hits(
        self,
        hits: list[dict[str, Any]],
        limit: int,
    ) -> list[dict[str, Any]]:
        start_time = time.perf_counter()
        ordered_ids: list[uuid.UUID] = []
        score_map: dict[uuid.UUID, float] = {}
        for hit in hits:
            assistant_uuid = self._extract_assistant_uuid(hit)
            if not assistant_uuid:
                continue
            if assistant_uuid not in score_map:
                ordered_ids.append(assistant_uuid)
            score = hit.get("score")
            if score is not None and score > score_map.get(
                assistant_uuid, float("-inf")
            ):
                score_map[assistant_uuid] = float(score)

        if not ordered_ids:
            return []

        candidates = await self._hydrate_candidates(ordered_ids, score_map)
        if not candidates:
            return []

        candidates.sort(key=lambda c: c.get("score", 0.0), reverse=True)
        returned = candidates[:limit]
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)
        logger.info(
            "assistant_retrieval_scored",
            extra={
                "hits": len(hits),
                "unique_candidates": len(ordered_ids),
                "candidates": len(candidates),
                "returned": len(returned),
                "elapsed_ms": elapsed_ms,
            },
        )
        return returned

    async def _fallback_default_assistant(self, *, reason: str) -> list[dict[str, Any]]:
        try:
            service = DefaultAssistantService(self.session)
            candidate = await service.get_default_candidate()
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("default assistant fallback failed", exc_info=exc)
            return []
        if not candidate:
            return []
        logger.info(
            "assistant_retrieval_fallback_default",
            extra={"reason": reason},
        )
        return [candidate]

    async def _hydrate_candidates(
        self,
        ordered_ids: list[uuid.UUID],
        score_map: dict[uuid.UUID, float],
    ) -> list[dict[str, Any]]:
        hydrated = await self._fetch_hydrated_rows(ordered_ids)
        if not hydrated:
            return []

        candidates: list[dict[str, Any]] = []
        for assistant_id in ordered_ids:
            row = hydrated.get(assistant_id)
            if not row:
                continue
            assistant, version, review_status, routing_state = row
            if not version:
                continue
            if not self._is_public_published(assistant):
                continue
            if assistant.owner_user_id is not None:
                normalized_review = (
                    review_status.value
                    if hasattr(review_status, "value")
                    else review_status
                )
                if normalized_review != ReviewStatus.APPROVED.value:
                    continue
            final_score = self._compute_final_score(
                vector_score=score_map.get(assistant.id, 0.0),
                routing_state=routing_state,
            )
            candidates.append(
                {
                    "assistant_id": str(assistant.id),
                    "name": version.name,
                    "summary": assistant.summary,
                    "score": final_score,
                }
            )

        return candidates

    async def _fetch_hydrated_rows(
        self,
        assistant_ids: list[uuid.UUID],
    ) -> dict[
        uuid.UUID,
        tuple[
            Assistant, AssistantVersion | None, str | None, AssistantRoutingState | None
        ],
    ]:
        if not assistant_ids:
            return {}
        stmt = (
            select(
                Assistant, AssistantVersion, ReviewTask.status, AssistantRoutingState
            )
            .join(
                AssistantVersion,
                Assistant.current_version_id == AssistantVersion.id,
                isouter=True,
            )
            .join(
                ReviewTask,
                and_(
                    ReviewTask.entity_type == ASSISTANT_MARKET_ENTITY,
                    ReviewTask.entity_id == Assistant.id,
                ),
                isouter=True,
            )
            .join(
                AssistantRoutingState,
                AssistantRoutingState.assistant_id == Assistant.id,
                isouter=True,
            )
            .where(Assistant.id.in_(assistant_ids))
        )
        result = await self.session.execute(stmt)
        rows = result.all()
        hydrated: dict[
            uuid.UUID,
            tuple[
                Assistant,
                AssistantVersion | None,
                str | None,
                AssistantRoutingState | None,
            ],
        ] = {}
        for assistant, version, review_status, routing_state in rows:
            hydrated[assistant.id] = (assistant, version, review_status, routing_state)
        return hydrated

    def _extract_assistant_uuid(self, hit: dict[str, Any]) -> uuid.UUID | None:
        payload = hit.get("payload") or {}
        assistant_id = (
            payload.get("assistant_id") or payload.get("uuid") or hit.get("id")
        )
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

    def _compute_final_score(
        self,
        *,
        vector_score: float,
        routing_state: AssistantRoutingState | None,
    ) -> float:
        mab_score = self._compute_mab_score(routing_state)
        exploration_bonus = self._compute_exploration_bonus(routing_state)
        return (vector_score * 0.6) + (mab_score * 0.3) + (exploration_bonus * 0.1)

    @staticmethod
    def _compute_mab_score(state: AssistantRoutingState | None) -> float:
        if not state:
            return 0.5
        alpha = 1 + int(state.positive_feedback or 0)
        beta = 1 + int(state.negative_feedback or 0)
        return float(random.betavariate(alpha, beta))

    @staticmethod
    def _compute_exploration_bonus(state: AssistantRoutingState | None) -> float:
        if not state:
            return 0.2
        total_trials = int(state.total_trials or 0)
        return 0.2 if total_trials < 10 else 0.0

    async def _fetch_assistants_with_version(
        self,
        assistant_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, tuple[Assistant, AssistantVersion | None]]:
        if not assistant_ids:
            return {}
        stmt = (
            select(Assistant, AssistantVersion)
            .join(
                AssistantVersion,
                Assistant.current_version_id == AssistantVersion.id,
                isouter=True,
            )
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
        assistant_id = (
            payload.get("assistant_id") or payload.get("uuid") or hit.get("id")
        )
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
            assistant.status.value
            if isinstance(assistant.status, AssistantStatus)
            else assistant.status
        )
        if (
            visibility != AssistantVisibility.PUBLIC.value
            or status != AssistantStatus.PUBLISHED.value
        ):
            return None

        if assistant.owner_user_id is not None:
            # Align with assistant market visibility rule: require approved review for user-owned assistants.
            review = await self.review_repo.get_by_entity(
                ASSISTANT_MARKET_ENTITY, assistant.id
            )
            if not review:
                return None
            review_status = (
                review.status.value
                if isinstance(review.status, ReviewStatus)
                else review.status
            )
            if review_status != ReviewStatus.APPROVED.value:
                return None

        version = await self.version_repo.get_for_assistant(
            assistant_uuid, assistant.current_version_id
        )
        if not version:
            return None

        score = hit.get("score")
        return {
            "assistant_id": str(assistant.id),
            "name": version.name,
            "summary": assistant.summary,
            "score": float(score) if score is not None else 0.0,
        }
