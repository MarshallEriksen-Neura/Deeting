from __future__ import annotations

import pytest

from app.models.user_notification_channel import NotificationChannel
from app.services.notifications.user_notification_service import UserNotificationService


class _DummySession:
    pass


@pytest.mark.asyncio
async def test_secure_channel_config_encrypts_sensitive_fields(monkeypatch):
    service = UserNotificationService(_DummySession())  # type: ignore[arg-type]

    async def _fake_store(provider: str, raw_secret: str, db_session):
        assert provider == "notification_feishu"
        assert raw_secret == "https://hooks.example"
        return "db:secret-ref"

    monkeypatch.setattr(service.secret_manager, "store", _fake_store)

    secured = await service._secure_channel_config(
        NotificationChannel.FEISHU,
        {"webhook_url": "https://hooks.example", "display_name": "my_feishu"},
    )
    assert secured["webhook_url"] == "db:secret-ref"
    assert secured["display_name"] == "my_feishu"


@pytest.mark.asyncio
async def test_resolve_runtime_config_decrypts_db_ref(monkeypatch):
    service = UserNotificationService(_DummySession())  # type: ignore[arg-type]

    async def _fake_get(provider: str, secret_ref_id: str, db_session, allow_env: bool):
        assert provider == "notification_feishu"
        assert secret_ref_id == "db:secret-ref"
        assert allow_env is False
        return "https://hooks.decrypted"

    monkeypatch.setattr(service.secret_manager, "get", _fake_get)

    resolved = await service.resolve_runtime_config(
        NotificationChannel.FEISHU,
        {"webhook_url": "db:secret-ref", "display_name": "my_feishu"},
    )
    assert resolved["webhook_url"] == "https://hooks.decrypted"
    assert resolved["display_name"] == "my_feishu"
