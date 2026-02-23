from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.models.assistant import (
    Assistant,
    AssistantStatus,
    AssistantVersion,
    AssistantVisibility,
)


async def _seed_assistant_with_version(session) -> tuple[Assistant, AssistantVersion]:
    assistant_id = uuid4()
    version_id = uuid4()

    assistant = Assistant(
        id=assistant_id,
        visibility=AssistantVisibility.PRIVATE,
        status=AssistantStatus.DRAFT,
        summary=f"admin-list-{assistant_id}",
        icon_id="lucide:bot",
        current_version_id=version_id,
    )
    version = AssistantVersion(
        id=version_id,
        assistant_id=assistant_id,
        version="0.1.0",
        name="Admin List Assistant",
        description="admin list regression",
        system_prompt="You are a helpful assistant.",
        model_config={"temperature": 0.1},
        skill_refs=[],
        tags=["admin-list"],
    )

    session.add_all([assistant, version])
    await session.commit()
    return assistant, version


@pytest.mark.asyncio
async def test_admin_assistants_list_includes_versions_without_missing_greenlet(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
) -> None:
    async with AsyncSessionLocal() as session:
        assistant, version = await _seed_assistant_with_version(session)

    resp = await client.get(
        "/api/v1/admin/assistants?size=50",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )
    assert resp.status_code == 200

    data = resp.json()
    assert data["size"] >= 1

    item = next(
        (entry for entry in data["items"] if entry["id"] == str(assistant.id)),
        None,
    )
    assert item is not None
    assert len(item["versions"]) == 1
    assert item["versions"][0]["id"] == str(version.id)
    assert item["versions"][0]["model_config"] == {"temperature": 0.1}
