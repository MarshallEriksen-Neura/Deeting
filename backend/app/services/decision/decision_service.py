from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass
class DecisionCandidate:
    arm_id: str
    base_score: float
    bandit_score: float | None = None
    final_score: float | None = None


class DecisionService:
    def __init__(
        self,
        repo: Any,
        *,
        vector_weight: float = 0.75,
        bandit_weight: float = 0.25,
        exploration_bonus: float = 0.3,
    ) -> None:
        self.repo = repo
        self.vector_weight = vector_weight
        self.bandit_weight = bandit_weight
        self.exploration_bonus = exploration_bonus

    async def rank_candidates(
        self,
        scene: str,
        candidates: list[DecisionCandidate],
    ) -> list[DecisionCandidate]:
        if not candidates:
            return []

        states = await self.repo.get_states_map(scene, [c.arm_id for c in candidates])
        for candidate in candidates:
            state = states.get(candidate.arm_id)
            candidate.bandit_score = _compute_bandit_score(state)
            exploration = self.exploration_bonus if _is_cold_start(state) else 0.0
            candidate.final_score = (
                candidate.base_score * self.vector_weight
                + (candidate.bandit_score or 0.0) * self.bandit_weight
                + exploration
            )

        return sorted(
            candidates, key=lambda c: c.final_score or 0.0, reverse=True
        )

    async def record_feedback(
        self,
        scene: str,
        arm_id: str,
        reward: float,
        *,
        success: bool | None = None,
    ) -> None:
        if not hasattr(self.repo, "record_feedback"):
            return
        await self.repo.record_feedback(
            scene=scene,
            arm_id=arm_id,
            success=True if success is None else success,
            latency_ms=None,
            cost=None,
            reward=reward,
        )


def _is_cold_start(state: Any) -> bool:
    return state is None or getattr(state, "total_trials", 0) <= 0


def _compute_bandit_score(state: Any) -> float:
    if state is None:
        return 0.0
    total = getattr(state, "total_trials", 0) or 0
    if total <= 0:
        return 0.0
    successes = getattr(state, "successes", 0) or 0
    return float(successes) / float(total)
