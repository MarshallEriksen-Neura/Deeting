import pytest
from httpx import AsyncClient
from sqlalchemy import select
from uuid import UUID

from app.models.assistant_install import AssistantInstall


@pytest.mark.asyncio
async def test_create_assistant_share_triggers_review_and_install(
    client: AsyncClient,
    auth_tokens: dict,
    test_user: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    scheduled: list[tuple[UUID, UUID]] = []

    def fake_schedule(assistant_id: UUID, user_id: UUID) -> None:
        scheduled.append((assistant_id, user_id))

    monkeypatch.setattr("app.api.v1.assistants_route._schedule_assistant_share_review", fake_schedule)

    payload = {
        "visibility": "private",
        "status": "draft",
        "summary": "用于分享测试",
        "icon_id": "lucide:bot",
        "share_to_market": True,
        "version": {
            "name": "Share Assistant",
            "description": "share flow",
            "system_prompt": "You are a helpful assistant.",
            "tags": ["share"],
        },
    }
    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    resp = await client.post("/api/v1/assistants", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["visibility"] == "public"
    assert data["status"] == "published"

    assistant_id = UUID(data["id"])
    user_id = UUID(test_user["id"])
    assert scheduled == [(assistant_id, user_id)]

    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(AssistantInstall).where(
                AssistantInstall.user_id == user_id,
                AssistantInstall.assistant_id == assistant_id,
            )
        )
        assert res.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_create_assistant_without_share_skips_review(
    client: AsyncClient,
    auth_tokens: dict,
    test_user: dict,
    AsyncSessionLocal,
    monkeypatch,
):
    def fail_schedule(*_args, **_kwargs) -> None:
        raise AssertionError("share review should not be scheduled")

    monkeypatch.setattr("app.api.v1.assistants_route._schedule_assistant_share_review", fail_schedule)

    payload = {
        "visibility": "private",
        "status": "draft",
        "summary": "仅创建",
        "icon_id": "lucide:bot",
        "share_to_market": False,
        "version": {
            "name": "Private Assistant",
            "description": "private flow",
            "system_prompt": "You are a helpful assistant.",
            "tags": ["private"],
        },
    }
    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    resp = await client.post("/api/v1/assistants", json=payload, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["visibility"] == "private"
    assert data["status"] == "draft"

    assistant_id = UUID(data["id"])
    user_id = UUID(test_user["id"])
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(AssistantInstall).where(
                AssistantInstall.user_id == user_id,
                AssistantInstall.assistant_id == assistant_id,
            )
        )
        assert res.scalar_one_or_none() is not None
