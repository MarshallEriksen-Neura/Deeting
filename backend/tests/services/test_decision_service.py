from __future__ import annotations

import random
from dataclasses import dataclass

import pytest

from app.services.decision.decision_service import DecisionCandidate, DecisionService


@dataclass
class FakeState:
    successes: int
    failures: int
    total_trials: int
    alpha: float = 1.0
    beta: float = 1.0


class FakeBanditRepo:
    def __init__(self, states: dict[tuple[str, str], FakeState]) -> None:
        self._states = states

    async def get_states_map(self, scene: str, arm_ids: list[str]):
        return {arm_id: self._states.get((scene, arm_id)) for arm_id in arm_ids}


@pytest.mark.asyncio
async def test_rank_candidates_epsilon_greedy_prefers_random_score():
    repo = FakeBanditRepo(
        states={
            ("retrieval:skill", "skill__a"): FakeState(
                successes=10, failures=0, total_trials=10, alpha=1, beta=1
            ),
            ("retrieval:skill", "skill__b"): FakeState(
                successes=0, failures=0, total_trials=0, alpha=1, beta=1
            ),
        }
    )
    rng = random.Random(0)
    service = DecisionService(
        repo,
        strategy="epsilon_greedy",
        epsilon=1.0,
        final_score="bandit_only",
        rng=rng,
    )
    candidates = [
        DecisionCandidate(arm_id="skill__a", base_score=0.80),
        DecisionCandidate(arm_id="skill__b", base_score=0.78),
    ]

    ranked = await service.rank_candidates("retrieval:skill", candidates)

    assert ranked[0].arm_id == "skill__b"


@pytest.mark.asyncio
async def test_rank_candidates_thompson_sampling_prefers_higher_posterior():
    repo = FakeBanditRepo(
        states={
            ("retrieval:skill", "skill__a"): FakeState(
                successes=9, failures=1, total_trials=10, alpha=10, beta=1
            ),
            ("retrieval:skill", "skill__b"): FakeState(
                successes=1, failures=9, total_trials=10, alpha=1, beta=10
            ),
        }
    )
    rng = random.Random(0)
    service = DecisionService(repo, strategy="thompson", rng=rng)
    candidates = [
        DecisionCandidate(arm_id="skill__a", base_score=0.50),
        DecisionCandidate(arm_id="skill__b", base_score=0.50),
    ]

    ranked = await service.rank_candidates("retrieval:skill", candidates)

    assert ranked[0].arm_id == "skill__a"


@pytest.mark.asyncio
async def test_rank_candidates_ucb_gives_exploration_bonus_to_low_trials():
    repo = FakeBanditRepo(
        states={
            ("retrieval:skill", "skill__a"): FakeState(
                successes=1, failures=0, total_trials=1, alpha=1, beta=1
            ),
            ("retrieval:skill", "skill__b"): FakeState(
                successes=6, failures=4, total_trials=10, alpha=1, beta=1
            ),
        }
    )
    service = DecisionService(
        repo,
        strategy="ucb",
        ucb_c=0.1,
        ucb_min_trials=5,
        final_score="bandit_only",
    )
    candidates = [
        DecisionCandidate(arm_id="skill__a", base_score=0.10),
        DecisionCandidate(arm_id="skill__b", base_score=0.90),
    ]

    ranked = await service.rank_candidates("retrieval:skill", candidates)

    assert ranked[0].arm_id == "skill__a"


@pytest.mark.asyncio
async def test_rank_candidates_vector_only_respects_base_score():
    repo = FakeBanditRepo(
        states={
            ("retrieval:skill", "skill__a"): FakeState(
                successes=10, failures=0, total_trials=10, alpha=1, beta=1
            ),
            ("retrieval:skill", "skill__b"): FakeState(
                successes=0, failures=10, total_trials=10, alpha=1, beta=1
            ),
        }
    )
    service = DecisionService(repo, final_score="vector_only")
    candidates = [
        DecisionCandidate(arm_id="skill__a", base_score=0.30),
        DecisionCandidate(arm_id="skill__b", base_score=0.80),
    ]

    ranked = await service.rank_candidates("retrieval:skill", candidates)

    assert ranked[0].arm_id == "skill__b"
