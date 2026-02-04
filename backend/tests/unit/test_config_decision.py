def test_decision_settings_defaults():
    from app.core.config import settings

    assert settings.DECISION_STRATEGY in {"thompson", "ucb", "epsilon_greedy"}
    assert settings.DECISION_FINAL_SCORE in {
        "weighted_sum",
        "bandit_only",
        "vector_only",
    }
