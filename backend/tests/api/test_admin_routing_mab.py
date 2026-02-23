from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from app.models import (
    Assistant,
    AssistantRoutingState,
    AssistantStatus,
    AssistantVersion,
    AssistantVisibility,
)


async def _seed_assistant_with_routing(
    session,
    *,
    name: str,
    summary: str,
    total_trials: int,
    positive_feedback: int,
    negative_feedback: int,
) -> UUID:
    assistant_id = uuid4()
    version_id = uuid4()

    assistant = Assistant(
        id=assistant_id,
        visibility=AssistantVisibility.PRIVATE,
        status=AssistantStatus.DRAFT,
        summary=summary,
        icon_id="lucide:bot",
        current_version_id=version_id,
    )
    version = AssistantVersion(
        id=version_id,
        assistant_id=assistant_id,
        version="0.1.0",
        name=name,
        description=f"{name} description",
        system_prompt="You are a helpful assistant.",
        model_config={"temperature": 0.1},
        skill_refs=[],
        tags=["routing-mab"],
    )
    state = AssistantRoutingState(
        assistant_id=assistant_id,
        total_trials=total_trials,
        positive_feedback=positive_feedback,
        negative_feedback=negative_feedback,
    )

    session.add_all([assistant, version, state])
    await session.commit()
    return assistant_id


@pytest.mark.asyncio
async def test_admin_routing_mab_assistants_report(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
) -> None:
    async with AsyncSessionLocal() as session:
        assistant_a_id = await _seed_assistant_with_routing(
            session,
            name="Assistant A",
            summary="summary-a",
            total_trials=20,
            positive_feedback=16,
            negative_feedback=4,
        )
        assistant_b_id = await _seed_assistant_with_routing(
            session,
            name="Assistant B",
            summary="summary-b",
            total_trials=5,
            positive_feedback=2,
            negative_feedback=3,
        )

    resp = await client.get(
        "/api/v1/admin/routing-mab/assistants",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )
    assert resp.status_code == 200

    payload = resp.json()
    assert "assistants" in payload
    assert len(payload["assistants"]) >= 2

    rows = {item["assistantId"]: item for item in payload["assistants"]}
    item_a = rows[str(assistant_a_id)]
    item_b = rows[str(assistant_b_id)]

    assert item_a["name"] == "Assistant A"
    assert item_a["totalTrials"] == 20
    assert item_a["positiveFeedback"] == 16
    assert item_a["negativeFeedback"] == 4
    assert item_a["selectionRatio"] == 0.8
    assert item_a["isExploring"] is False

    assert item_b["name"] == "Assistant B"
    assert item_b["totalTrials"] == 5
    assert item_b["selectionRatio"] == 0.2
    assert item_b["isExploring"] is True


@pytest.mark.asyncio
async def test_admin_routing_mab_assistants_report_rejects_invalid_sort(
    client: AsyncClient,
    admin_tokens: dict,
) -> None:
    resp = await client.get(
        "/api/v1/admin/routing-mab/assistants?sort=bad_sort",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid sort option"
