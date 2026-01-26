from __future__ import annotations

import json
import uuid

import pytest

from app.models.spec_agent import SpecExecutionLog, SpecPlan
from app.schemas.spec_agent import SpecManifest
from app.services.agent import spec_agent_service
from app.utils.time_utils import Datetime


@pytest.mark.asyncio
async def test_spec_agent_draft_non_stream(client, auth_tokens, monkeypatch):
    manifest_payload = {
        "spec_v": "1.2",
        "project_name": "Draft_Test",
        "context": {},
        "nodes": [
            {
                "id": "T1",
                "type": "action",
                "instruction": "do work",
                "needs": [],
            }
        ],
    }

    async def fake_chat_completion(*_args, **_kwargs):
        return json.dumps(manifest_payload, ensure_ascii=False)

    async def noop(*_args, **_kwargs):
        return None

    async def fake_mcp_tools(*_args, **_kwargs):
        return ([], {})

    def fake_local_tools(*_args, **_kwargs):
        return ([], {})

    monkeypatch.setattr(
        "app.services.spec_agent_service.llm_service.chat_completion", fake_chat_completion
    )
    monkeypatch.setattr(spec_agent_service, "initialize_plugins", noop)
    monkeypatch.setattr(spec_agent_service, "_load_mcp_tools", fake_mcp_tools)
    monkeypatch.setattr(spec_agent_service, "_load_local_tools", fake_local_tools)

    resp = await client.post(
        "/api/v1/spec-agent/draft?stream=false",
        json={"query": "hello", "context": {"foo": "bar"}},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["manifest"]["project_name"] == "Draft_Test"
    assert data["manifest"]["context"]["foo"] == "bar"


@pytest.mark.asyncio
async def test_spec_agent_status_progress(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Status_Test",
        nodes=[
            {"id": "T1", "type": "action", "instruction": "do work", "needs": []},
            {"id": "T2", "type": "action", "instruction": "do more", "needs": ["T1"]},
        ],
    )

    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=user_id,
            project_name="Status_Test",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="RUNNING",
        )
        session.add(plan)
        await session.commit()

        log = SpecExecutionLog(
            plan_id=plan.id,
            node_id="T1",
            status="SUCCESS",
            output_data={"value": 1},
            started_at=Datetime.now(),
            completed_at=Datetime.now(),
        )
        session.add(log)
        await session.commit()

        plan_id = plan.id

    resp = await client.get(
        f"/api/v1/spec-agent/plans/{plan_id}/status",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["execution"]["progress"] == 50
    node_map = {node["id"]: node for node in data["nodes"]}
    assert node_map["T1"]["status"] == "completed"
    assert node_map["T2"]["status"] == "pending"


@pytest.mark.asyncio
async def test_spec_agent_start_empty_plan(
    client, auth_tokens, AsyncSessionLocal, test_user, monkeypatch
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Empty_Plan",
        nodes=[],
    )

    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=user_id,
            project_name="Empty_Plan",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="DRAFT",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

    async def noop(*_args, **_kwargs):
        return None

    async def fake_mcp_tools(*_args, **_kwargs):
        return ([], {})

    def fake_local_tools(*_args, **_kwargs):
        return ([], {})

    monkeypatch.setattr(spec_agent_service, "initialize_plugins", noop)
    monkeypatch.setattr(spec_agent_service, "_load_mcp_tools", fake_mcp_tools)
    monkeypatch.setattr(spec_agent_service, "_load_local_tools", fake_local_tools)

    resp = await client.post(
        f"/api/v1/spec-agent/plans/{plan_id}/start",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"

    async with AsyncSessionLocal() as session:
        reloaded = await session.get(SpecPlan, plan_id)
        assert reloaded is not None
        assert reloaded.status == "COMPLETED"


@pytest.mark.asyncio
async def test_spec_agent_interact_approve(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Interact_Plan",
        nodes=[
            {
                "id": "T1",
                "type": "action",
                "instruction": "do work",
                "needs": [],
            }
        ],
    )

    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=user_id,
            project_name="Interact_Plan",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="PAUSED",
        )
        session.add(plan)
        await session.commit()

        log = SpecExecutionLog(
            plan_id=plan.id,
            node_id="T1",
            status="WAITING_APPROVAL",
            input_snapshot={"id": "T1"},
            started_at=Datetime.now(),
        )
        session.add(log)
        await session.commit()
        plan_id = plan.id
        log_id = log.id

    resp = await client.post(
        f"/api/v1/spec-agent/plans/{plan_id}/interact",
        json={"node_id": "T1", "decision": "approve", "feedback": "ok"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["decision"] == "approve"

    async with AsyncSessionLocal() as session:
        reloaded = await session.get(SpecPlan, plan_id)
        assert reloaded is not None
        assert reloaded.status == "RUNNING"

        result = await session.get(SpecExecutionLog, log_id)
        assert result is not None
        assert result.status == "SUCCESS"
