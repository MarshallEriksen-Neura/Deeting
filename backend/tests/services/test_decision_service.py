from __future__ import annotations

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
async def test_rank_candidates_prefers_bandit_with_exploration():
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
    service = DecisionService(repo)
    candidates = [
        DecisionCandidate(arm_id="skill__a", base_score=0.80),
        DecisionCandidate(arm_id="skill__b", base_score=0.78),
    ]

    ranked = await service.rank_candidates("retrieval:skill", candidates)

    assert ranked[0].arm_id == "skill__b"
