from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models.assistant import Assistant, AssistantVersion
from app.models.assistant_routing import AssistantRoutingState
from app.repositories.assistant_routing_repository import AssistantRoutingRepository


class AssistantRoutingService:
    def __init__(self, session):
        self.repo = AssistantRoutingRepository(session)

    async def record_trial(self, assistant_id: UUID) -> None:
        await self.repo.record_trial(assistant_id)

    async def record_feedback(self, assistant_id: UUID, event: str) -> None:
        normalized = str(event or "").strip().lower()
        if normalized in {"thumbs_up", "like", "up", "positive"}:
            await self.repo.record_feedback(assistant_id, positive=True)
        elif normalized in {"thumbs_down", "dislike", "down", "negative", "regenerate"}:
            await self.repo.record_feedback(assistant_id, positive=False)
        else:
            raise ValueError("unknown feedback event")

    async def list_routing_report(
        self,
        *,
        min_trials: int | None = None,
        min_rating: float | None = None,
        limit: int | None = None,
        sort: str | None = None,
    ) -> list[dict]:
        stmt = (
            select(AssistantRoutingState, Assistant, AssistantVersion)
            .join(Assistant, AssistantRoutingState.assistant_id == Assistant.id)
            .join(
                AssistantVersion,
                Assistant.current_version_id == AssistantVersion.id,
                isouter=True,
            )
        )
        result = await self.repo.session.execute(stmt)
        rows = result.all()
        items: list[dict] = []
        for state, assistant, version in rows:
            total = int(state.total_trials or 0)
            pos = int(state.positive_feedback or 0)
            neg = int(state.negative_feedback or 0)
            rating = (pos + 1) / (pos + neg + 2)
            mab_score = rating
            exploration = 0.2 if total < 10 else 0.0
            # 对齐 MAB + exploration（去掉向量相似度后，保留 3:1 权重）
            routing_score = (rating * 0.75) + (exploration * 0.25)
            items.append(
                {
                    "assistant_id": assistant.id,
                    "name": version.name if version else None,
                    "summary": assistant.summary,
                    "total_trials": total,
                    "positive_feedback": pos,
                    "negative_feedback": neg,
                    "rating_score": float(rating),
                    "mab_score": float(mab_score),
                    "routing_score": float(routing_score),
                    "exploration_bonus": exploration,
                    "last_used_at": state.last_used_at,
                    "last_feedback_at": state.last_feedback_at,
                }
            )
        filtered = self._filter_report_items(items, min_trials=min_trials, min_rating=min_rating)
        sorted_items = self._sort_report_items(filtered, sort=sort)
        if limit is not None:
            return sorted_items[: max(limit, 0)]
        return sorted_items

    @staticmethod
    def _filter_report_items(
        items: list[dict],
        *,
        min_trials: int | None,
        min_rating: float | None,
    ) -> list[dict]:
        filtered = items
        if min_trials is not None:
            filtered = [item for item in filtered if item.get("total_trials", 0) >= min_trials]
        if min_rating is not None:
            filtered = [item for item in filtered if item.get("rating_score", 0.0) >= min_rating]
        return filtered

    @staticmethod
    def _sort_report_items(items: list[dict], *, sort: str | None) -> list[dict]:
        key = (sort or "score_desc").lower()
        if key in {"score_desc", "routing_score_desc"}:
            return sorted(items, key=lambda item: item.get("routing_score", 0.0), reverse=True)
        if key in {"rating_desc"}:
            return sorted(items, key=lambda item: item.get("rating_score", 0.0), reverse=True)
        if key in {"trials_desc"}:
            return sorted(items, key=lambda item: item.get("total_trials", 0), reverse=True)
        if key in {"recent_desc"}:
            return sorted(items, key=lambda item: item.get("last_used_at") or 0, reverse=True)
        return sorted(items, key=lambda item: item.get("routing_score", 0.0), reverse=True)
