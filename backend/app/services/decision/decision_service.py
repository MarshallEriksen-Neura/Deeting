from __future__ import annotations

import hashlib
import logging
import math
import random
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

_ALLOWED_STRATEGIES = {"thompson", "ucb", "epsilon_greedy"}
_ALLOWED_FINAL_SCORES = {"weighted_sum", "bandit_only", "vector_only"}


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
        strategy: str = "thompson",
        final_score: str = "weighted_sum",
        epsilon: float = 0.1,
        ucb_c: float = 1.5,
        ucb_min_trials: int = 5,
        thompson_prior_alpha: float = 1.0,
        thompson_prior_beta: float = 1.0,
        rng: random.Random | None = None,
    ) -> None:
        self.repo = repo
        self.vector_weight = vector_weight
        self.bandit_weight = bandit_weight
        self.exploration_bonus = exploration_bonus
        if strategy not in _ALLOWED_STRATEGIES:
            logger.warning(
                "DecisionService: unknown strategy %s, fallback to thompson", strategy
            )
            strategy = "thompson"
        if final_score not in _ALLOWED_FINAL_SCORES:
            logger.warning(
                "DecisionService: unknown final_score %s, fallback to weighted_sum",
                final_score,
            )
            final_score = "weighted_sum"
        self.strategy = strategy
        self.final_score = final_score
        self.epsilon = epsilon
        self.ucb_c = ucb_c
        self.ucb_min_trials = ucb_min_trials
        self.thompson_prior_alpha = thompson_prior_alpha
        self.thompson_prior_beta = thompson_prior_beta
        self._rng = rng or random.Random()

    async def rank_candidates(
        self,
        scene: str,
        candidates: list[DecisionCandidate],
    ) -> list[DecisionCandidate]:
        if not candidates:
            return []

        states = await self.repo.get_states_map(scene, [c.arm_id for c in candidates])
        base_seed = self._rng.randrange(0, 2**32)
        for candidate in candidates:
            state = states.get(candidate.arm_id)
            candidate.bandit_score = _compute_bandit_score(
                state,
                strategy=self.strategy,
                epsilon=self.epsilon,
                ucb_c=self.ucb_c,
                ucb_min_trials=self.ucb_min_trials,
                thompson_prior_alpha=self.thompson_prior_alpha,
                thompson_prior_beta=self.thompson_prior_beta,
                rng=_rng_for_candidate(base_seed, candidate.arm_id),
            )
            exploration = self.exploration_bonus if _is_cold_start(state) else 0.0
            candidate.final_score = _compute_final_score(
                self.final_score,
                base_score=candidate.base_score,
                bandit_score=candidate.bandit_score,
                vector_weight=self.vector_weight,
                bandit_weight=self.bandit_weight,
                exploration_bonus=exploration,
            )

        return sorted(candidates, key=lambda c: c.final_score or 0.0, reverse=True)

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


def _compute_bandit_score(
    state: Any,
    *,
    strategy: str,
    epsilon: float,
    ucb_c: float,
    ucb_min_trials: int,
    thompson_prior_alpha: float,
    thompson_prior_beta: float,
    rng: random.Random,
) -> float:
    if strategy == "thompson":
        return _score_thompson(
            state,
            prior_alpha=thompson_prior_alpha,
            prior_beta=thompson_prior_beta,
            rng=rng,
        )
    if strategy == "ucb":
        return _score_ucb(state, c=ucb_c, min_trials=ucb_min_trials)
    if strategy == "epsilon_greedy":
        return _score_epsilon_greedy(state, epsilon=epsilon, rng=rng)
    return _score_success_rate(state)


def _score_thompson(
    state: Any,
    *,
    prior_alpha: float,
    prior_beta: float,
    rng: random.Random,
) -> float:
    if state is None:
        return rng.betavariate(prior_alpha, prior_beta)
    alpha = getattr(state, "alpha", None) or prior_alpha
    beta = getattr(state, "beta", None) or prior_beta
    return rng.betavariate(float(alpha), float(beta))


def _score_ucb(state: Any, *, c: float, min_trials: int) -> float:
    if state is None:
        return 1.0
    total = getattr(state, "total_trials", 0) or 0
    if total <= 0:
        return 1.0
    if total < min_trials:
        return 1.0
    successes = getattr(state, "successes", 0) or 0
    success_rate = float(successes) / float(total)
    return success_rate + c * math.sqrt(math.log(total + 1) / float(total))


def _score_epsilon_greedy(
    state: Any,
    *,
    epsilon: float,
    rng: random.Random,
) -> float:
    if epsilon <= 0:
        return _score_success_rate(state)
    if rng.random() < epsilon:
        return rng.random()
    return _score_success_rate(state)


def _rng_for_candidate(base_seed: int, arm_id: str) -> random.Random:
    digest = hashlib.sha256(f"{base_seed}:{arm_id}".encode()).digest()
    seed = int.from_bytes(digest[:8], "big", signed=False)
    return random.Random(seed)


def _score_success_rate(state: Any) -> float:
    if state is None:
        return 0.0
    total = getattr(state, "total_trials", 0) or 0
    if total <= 0:
        return 0.0
    successes = getattr(state, "successes", 0) or 0
    return float(successes) / float(total)


def _compute_final_score(
    mode: str,
    *,
    base_score: float,
    bandit_score: float | None,
    vector_weight: float,
    bandit_weight: float,
    exploration_bonus: float,
) -> float:
    bandit_value = bandit_score or 0.0
    if mode == "bandit_only":
        return bandit_value + exploration_bonus
    if mode == "vector_only":
        return base_score
    return base_score * vector_weight + bandit_value * bandit_weight + exploration_bonus
