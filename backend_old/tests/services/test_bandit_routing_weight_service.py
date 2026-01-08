from __future__ import annotations

from uuid import UUID

import pytest

from app.schemas import PhysicalModel
from app.services.bandit_policy_service import BanditRecommendation, CandidateScore
from app.services.bandit_routing_weight_service import (
    apply_boost_factors_to_weights,
    build_bandit_routing_weights,
    build_provider_arm_key,
    compute_rank_boost_factors,
    parse_provider_arm_key,
)


def _upstream(provider_id: str, weight: float = 1.0) -> PhysicalModel:
    return PhysicalModel(
        provider_id=provider_id,
        model_id="gpt-4",
        endpoint="https://api.example.com/v1/chat/completions",
        base_weight=weight,
        region=None,
        max_qps=None,
        meta_hash=None,
        updated_at=1.0,
    )


def test_provider_arm_key_roundtrip():
    arm = build_provider_arm_key(logical_model_id="gpt-4", provider_id="openai")
    assert parse_provider_arm_key(arm) == ("gpt-4", "openai")


def test_compute_rank_boost_factors_uses_topn_with_decay():
    rec = BanditRecommendation(
        policy_version="ts-routing-v1",
        context_key="deadbeef" * 8,
        features={},
        candidates=[
            CandidateScore(
                logical_model=build_provider_arm_key(logical_model_id="gpt-4", provider_id="p1"),
                sampled_score=0.9,
                samples=50,
            ),
            CandidateScore(
                logical_model=build_provider_arm_key(logical_model_id="gpt-4", provider_id="p2"),
                sampled_score=0.8,
                samples=50,
            ),
            CandidateScore(
                logical_model=build_provider_arm_key(logical_model_id="gpt-4", provider_id="p3"),
                sampled_score=0.7,
                samples=50,
            ),
        ],
        exploration=False,
    )

    factors = compute_rank_boost_factors(
        rec,
        logical_model_id="gpt-4",
        top_n=2,
        max_boost=0.3,
        decay=0.5,
    )
    assert factors == {"p1": pytest.approx(1.3), "p2": pytest.approx(1.15)}


def test_apply_boost_factors_to_weights_clamps_to_provider_weight_limits():
    effective = apply_boost_factors_to_weights(
        base_weights={"p1": 1.0, "p2": 1.0},
        current_weights={"p1": 3.0, "p2": 1.0},
        boost_factors={"p1": 1.3},
    )
    assert effective["p1"] == pytest.approx(3.0)
    assert effective["p2"] == pytest.approx(1.0)


def test_build_bandit_routing_weights_respects_exploration_gating(monkeypatch):
    def _fake_recommend(*args, **kwargs):
        _ = (args, kwargs)
        return BanditRecommendation(
            policy_version="ts-routing-v1",
            context_key="deadbeef" * 8,
            features={},
            candidates=[
                CandidateScore(
                    logical_model=build_provider_arm_key(logical_model_id="gpt-4", provider_id="p1"),
                    sampled_score=0.9,
                    samples=0,
                ),
                CandidateScore(
                    logical_model=build_provider_arm_key(logical_model_id="gpt-4", provider_id="p2"),
                    sampled_score=0.8,
                    samples=0,
                ),
            ],
            exploration=True,
        )

    monkeypatch.setattr(
        "app.services.bandit_routing_weight_service.recommend_challengers", _fake_recommend
    )

    result = build_bandit_routing_weights(
        db=None,  # type: ignore[arg-type]
        project_id=UUID(int=0),
        assistant_id=UUID(int=1),
        logical_model_id="gpt-4",
        upstreams=[_upstream("p1"), _upstream("p2")],
        user_text="hi",
        request_payload={"messages": [{"role": "user", "content": "hi"}]},
        base_weights={"p1": 1.0, "p2": 1.0},
        current_weights={"p1": 1.0, "p2": 1.0},
        top_n=2,
        max_boost=0.3,
        decay=0.6,
        min_samples_per_arm=10,
        apply_during_exploration=False,
    )
    assert result is None


def test_build_bandit_routing_weights_returns_effective_dynamic_weights(monkeypatch):
    def _fake_recommend(*args, **kwargs):
        _ = (args, kwargs)
        return BanditRecommendation(
            policy_version="ts-routing-v1",
            context_key="deadbeef" * 8,
            features={},
            candidates=[
                CandidateScore(
                    logical_model=build_provider_arm_key(logical_model_id="gpt-4", provider_id="p2"),
                    sampled_score=0.9,
                    samples=12,
                ),
                CandidateScore(
                    logical_model=build_provider_arm_key(logical_model_id="gpt-4", provider_id="p1"),
                    sampled_score=0.8,
                    samples=12,
                ),
            ],
            exploration=True,
        )

    monkeypatch.setattr(
        "app.services.bandit_routing_weight_service.recommend_challengers", _fake_recommend
    )

    result = build_bandit_routing_weights(
        db=None,  # type: ignore[arg-type]
        project_id=UUID(int=0),
        assistant_id=UUID(int=1),
        logical_model_id="gpt-4",
        upstreams=[_upstream("p1"), _upstream("p2")],
        user_text="hi",
        request_payload={"messages": [{"role": "user", "content": "hi"}]},
        base_weights={"p1": 1.0, "p2": 1.0},
        current_weights={"p1": 1.0, "p2": 1.0},
        top_n=1,
        max_boost=0.3,
        decay=0.6,
        min_samples_per_arm=10,
        apply_during_exploration=False,
    )
    assert result is not None
    assert result.boost_factors == {"p2": pytest.approx(1.3)}
    assert result.dynamic_weights["p2"] == pytest.approx(1.3)
    assert result.dynamic_weights["p1"] == pytest.approx(1.0)

