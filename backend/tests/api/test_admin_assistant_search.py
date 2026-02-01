from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.models.assistant import Assistant, AssistantStatus, AssistantVersion, AssistantVisibility


async def _seed_public_assistant(session) -> Assistant:
    assistant_id = uuid4()
    version_id = uuid4()
    assistant = Assistant(
        id=assistant_id,
        visibility=AssistantVisibility.PUBLIC,
        status=AssistantStatus.PUBLISHED,
        owner_user_id=None,
        current_version_id=version_id,
    )
    version = AssistantVersion(
        id=version_id,
        assistant_id=assistant_id,
        version="0.1.0",
        name="Searchable Assistant",
        description="desc",
        system_prompt="prompt",
        model_config={},
        skill_refs=[],
        tags=[],
    )
    assistant.current_version_id = version.id
    session.add_all([assistant, version])
    await session.commit()
    await session.refresh(assistant)
    return assistant


@pytest.mark.asyncio
async def test_admin_assistant_search_uses_meili(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
    mocker,
) -> None:
    async with AsyncSessionLocal() as session:
        assistant = await _seed_public_assistant(session)

    backend = mocker.AsyncMock()
    backend.search_public_assistants.return_value = ([str(assistant.id)], None)
    mocker.patch(
        "app.services.assistant.assistant_service.get_search_backend",
        return_value=backend,
    )

    resp = await client.get(
        "/api/v1/admin/assistants/search?q=test",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["size"] == 1
    assert data["items"][0]["id"] == str(assistant.id)
    backend.search_public_assistants.assert_awaited_once()
