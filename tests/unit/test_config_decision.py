from pathlib import Path
import importlib.util


def test_decision_settings_defaults():
    base_dir = Path(__file__).resolve().parents[2] / "backend"
    config_path = base_dir / "app" / "core" / "config.py"
    spec = importlib.util.spec_from_file_location("config", config_path)
    assert spec and spec.loader
    config_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config_module)
    settings = config_module.Settings()

    assert settings.DECISION_STRATEGY == "thompson"
    assert settings.DECISION_FINAL_SCORE == "weighted_sum"
    assert settings.DECISION_VECTOR_WEIGHT == 0.75
    assert settings.DECISION_BANDIT_WEIGHT == 0.25
    assert settings.DECISION_EXPLORATION_BONUS == 0.3
    assert settings.DECISION_UCB_C == 1.5
    assert settings.DECISION_UCB_MIN_TRIALS == 5
    assert settings.DECISION_THOMPSON_PRIOR_ALPHA == 1.0
    assert settings.DECISION_THOMPSON_PRIOR_BETA == 1.0
