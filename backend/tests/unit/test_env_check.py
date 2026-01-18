from app.core import config
from app.scripts import env_check


def test_env_check_production_requires_keys(monkeypatch):
    for key in env_check.CHECK_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(config.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(config.settings, "ALLOW_INTERNAL_NETWORKS", False)
    monkeypatch.setattr(config.settings, "OUTBOUND_WHITELIST", ["api.allowed.com"])
    monkeypatch.setattr(config.settings, "BLOCKED_SUBNETS", ["127.0.0.0/8"])

    assert env_check.main() == 1


def test_env_check_development_warns_but_passes(monkeypatch):
    for key in env_check.CHECK_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(config.settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(config.settings, "ALLOW_INTERNAL_NETWORKS", False)
    monkeypatch.setattr(config.settings, "OUTBOUND_WHITELIST", ["api.allowed.com"])
    monkeypatch.setattr(config.settings, "BLOCKED_SUBNETS", ["127.0.0.0/8"])

    assert env_check.main() == 0


def test_env_check_strict_requires_keys(monkeypatch):
    for key in env_check.CHECK_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(config.settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(config.settings, "ALLOW_INTERNAL_NETWORKS", False)
    monkeypatch.setattr(config.settings, "OUTBOUND_WHITELIST", ["api.allowed.com"])
    monkeypatch.setattr(config.settings, "BLOCKED_SUBNETS", ["127.0.0.0/8"])
    monkeypatch.setattr(env_check.sys, "argv", ["env_check.py", "--strict"])
    assert env_check.main() == 1
