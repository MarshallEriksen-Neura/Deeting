"""
管理员通知 API 测试
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_admin_publish_notification_user(
    client: AsyncClient,
    admin_tokens: dict,
    test_user: dict,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.tasks.notification.publish_notification_to_user_task.delay",
        lambda *args, **kwargs: None,
    )
    response = await client.post(
        f"/api/v1/admin/notifications/users/{test_user['id']}",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        json={
            "title": "Admin Notice",
            "content": "Hello user",
            "type": "system",
            "level": "info",
            "payload": {"scope": "single"},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "notification_id" in data
    assert data["scheduled"] is True


@pytest.mark.asyncio
async def test_admin_publish_notification_broadcast(
    client: AsyncClient,
    admin_tokens: dict,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.tasks.notification.publish_notification_to_all_users_task.delay",
        lambda *args, **kwargs: None,
    )
    response = await client.post(
        "/api/v1/admin/notifications/broadcast",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        json={
            "title": "System Notice",
            "content": "Hello everyone",
            "type": "system",
            "level": "info",
            "active_only": True,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "notification_id" in data
    assert data["scheduled"] is True


@pytest.mark.asyncio
async def test_admin_publish_notification_no_permission(
    client: AsyncClient,
    auth_tokens: dict,
    test_user: dict,
):
    response = await client.post(
        f"/api/v1/admin/notifications/users/{test_user['id']}",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        json={
            "title": "No Permission",
            "content": "Should fail",
        },
    )
    assert response.status_code == 403
