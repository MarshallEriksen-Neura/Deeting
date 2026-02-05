from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.logging import logger
from app.core.transaction_celery import celery_is_available
from app.repositories.bandit_repository import BanditRepository
from app.repositories.gateway_log_repository import GatewayLogRepository
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.repositories.trace_feedback_repository import TraceFeedbackRepository
from app.services.assistant.assistant_routing_service import AssistantRoutingService
from app.services.skill_registry.skill_metrics_service import SkillMetricsService

SKILL_TOOL_PREFIX = "skill__"
SCENE_SKILL = "retrieval:skill"


class TraceFeedbackService:
    def __init__(self, session):
        self.session = session
        self.repo = TraceFeedbackRepository(session)

    async def create_feedback(
        self,
        *,
        trace_id: str,
        user_id: UUID | None,
        score: float,
        comment: str | None = None,
        tags: list[str] | None = None,
    ):
        feedback = await self.repo.create(
            {
                "trace_id": trace_id,
                "user_id": user_id,
                "score": score,
                "comment": comment,
                "tags": tags,
            }
        )

        if celery_is_available():
            from app.tasks.feedback_attribution import process_trace_feedback

            process_trace_feedback.delay(str(feedback.id))
        else:
            attribution_service = FeedbackAttributionService(self.session)
            await attribution_service.process_feedback(str(feedback.id))

        return feedback


class FeedbackAttributionService:
    def __init__(self, session):
        self.session = session
        self.feedback_repo = TraceFeedbackRepository(session)
        self.gateway_repo = GatewayLogRepository(session)
        self.bandit_repo = BanditRepository(session)
        self.skill_repo = SkillRegistryRepository(session)
        self.skill_metrics = SkillMetricsService(self.skill_repo)
        self.assistant_routing = AssistantRoutingService(session)

    async def process_feedback(self, feedback_id: str) -> None:
        feedback = await self.feedback_repo.get_by_id(feedback_id)
        if not feedback:
            return
        gateway_log = await self.gateway_repo.get_by_trace_id(feedback.trace_id)
        if not gateway_log:
            logger.warning(
                "trace_feedback_gateway_log_missing trace_id=%s",
                feedback.trace_id,
            )
            return

        tool_calls = _extract_tool_calls(gateway_log.meta)
        if tool_calls:
            await self._process_tool_calls(feedback.score, tool_calls)
            return

        await self._process_assistant_feedback(feedback.score, gateway_log.meta)

    async def _process_tool_calls(
        self,
        score: float,
        tool_calls: list[dict[str, Any]],
    ) -> None:
        for call in tool_calls:
            name = call.get("name")
            if not name:
                continue
            if not name.startswith(SKILL_TOOL_PREFIX):
                continue
            skill_id = name[len(SKILL_TOOL_PREFIX) :]
            success = bool(call.get("success", True))
            error = call.get("error")

            try:
                if not success:
                    await self.skill_metrics.record_failure(skill_id, error=error)
                await self.skill_metrics.record_feedback(skill_id, score)
            except ValueError as exc:
                logger.warning("trace_feedback_skill_missing skill=%s err=%s", skill_id, exc)
                continue

            reward = score
            if not success and reward > 0:
                reward = -1.0
            try:
                await self.bandit_repo.record_feedback(
                    scene=SCENE_SKILL,
                    arm_id=name,
                    success=success and reward > 0,
                    latency_ms=None,
                    cost=None,
                    reward=reward,
                    reward_metric_type="user_feedback",
                )
            except Exception as exc:
                logger.warning(
                    "trace_feedback_bandit_write_failed skill=%s err=%s",
                    skill_id,
                    exc,
                )

    async def _process_assistant_feedback(
        self, score: float, meta: dict[str, Any] | None
    ) -> None:
        assistant_id = (meta or {}).get("assistant_id")
        if not assistant_id or score == 0:
            return
        event = "thumbs_up" if score > 0 else "thumbs_down"
        try:
            await self.assistant_routing.record_feedback(UUID(str(assistant_id)), event)
        except Exception as exc:
            logger.warning(
                "trace_feedback_assistant_record_failed assistant=%s err=%s",
                assistant_id,
                exc,
            )


def _extract_tool_calls(meta: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(meta, dict):
        return []
    raw = meta.get("tool_calls")
    if not isinstance(raw, list):
        return []
    normalized = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if item.get("name"):
            normalized.append(item)
    return normalized


__all__ = ["TraceFeedbackService", "FeedbackAttributionService"]
