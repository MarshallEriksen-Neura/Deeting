from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

from app.models.user_notification_channel import UserNotificationChannel


@pytest.mark.asyncio
async def test_notification_channel_string_value_is_serializable(
    client: AsyncClient,
    auth_tokens: dict,
    test_user: dict,
    AsyncSessionLocal,
):
    user_id = UUID(test_user["id"])

    async with AsyncSessionLocal() as session:
        channel = UserNotificationChannel(
            user_id=user_id,
            channel="feishu",
            config={"webhook_url": "db:dummy"},
            display_name="测试渠道",
            is_active=True,
            priority=1,
        )
        session.add(channel)
        await session.commit()
        channel_id = str(channel.id)

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    try:
        list_resp = await client.get("/api/v1/notification-channels", headers=headers)
        assert list_resp.status_code == 200
        list_data = list_resp.json()
        item = next((x for x in list_data["items"] if x["id"] == channel_id), None)
        assert item is not None
        assert item["channel"] == "feishu"

        get_resp = await client.get(
            f"/api/v1/notification-channels/{channel_id}",
            headers=headers,
        )
        assert get_resp.status_code == 200
        get_data = get_resp.json()
        assert get_data["channel"] == "feishu"
        assert "config" in get_data
    finally:
        async with AsyncSessionLocal() as cleanup_session:
            existed = await cleanup_session.get(UserNotificationChannel, UUID(channel_id))
            if existed:
                await cleanup_session.delete(existed)
                await cleanup_session.commit()
