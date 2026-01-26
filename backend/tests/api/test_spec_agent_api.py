from __future__ import annotations

import json
import uuid

import pytest

from app.models.spec_agent import SpecExecutionLog, SpecPlan
from app.schemas.spec_agent import SpecManifest
from app.repositories.provider_instance_repository import ProviderModelRepository
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

    called: dict[str, str | None] = {}

    async def fake_chat_completion(*_args, **kwargs):
        called["model"] = kwargs.get("model")
        return json.dumps(manifest_payload, ensure_ascii=False)

    async def noop(*_args, **_kwargs):
        return None

    async def fake_mcp_tools(*_args, **_kwargs):
        return ([], {})

    def fake_local_tools(*_args, **_kwargs):
        return ([], {})

    monkeypatch.setattr(
        "app.services.agent.spec_agent_service.llm_service.chat_completion", fake_chat_completion
    )
    monkeypatch.setattr(spec_agent_service, "initialize_plugins", noop)
    monkeypatch.setattr(spec_agent_service, "_load_mcp_tools", fake_mcp_tools)
    monkeypatch.setattr(spec_agent_service, "_load_local_tools", fake_local_tools)

    resp = await client.post(
        "/api/v1/spec-agent/draft?stream=false",
        json={"query": "hello", "context": {"foo": "bar"}, "model": "gpt-4o-mini"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["manifest"]["project_name"] == "Draft_Test"
    assert data["manifest"]["context"]["foo"] == "bar"
    assert called["model"] == "gpt-4o-mini"


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


@pytest.mark.asyncio
async def test_spec_agent_update_node_model_success(
    client, auth_tokens, AsyncSessionLocal, test_user, monkeypatch
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Update_Model",
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
            project_name="Update_Model",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="DRAFT",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

    async def fake_candidates(
        self, capability, model_id, user_id, include_public=True
    ):
        if model_id == "gpt-4o":
            return [object()]
        return []

    monkeypatch.setattr(ProviderModelRepository, "get_candidates", fake_candidates)

    resp = await client.patch(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T1",
        json={"model_override": "gpt-4o"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["model_override"] == "gpt-4o"

    async with AsyncSessionLocal() as session:
        reloaded = await session.get(SpecPlan, plan_id)
        assert reloaded is not None
        reloaded_manifest = SpecManifest(**reloaded.manifest_data)
        node = next(item for item in reloaded_manifest.nodes if item.id == "T1")
        assert node.model_override == "gpt-4o"

    resp = await client.patch(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T1",
        json={"model_override": None},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    assert resp.json()["model_override"] is None


@pytest.mark.asyncio
async def test_spec_agent_update_node_model_non_action(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Update_Model_Non_Action",
        nodes=[
            {
                "id": "G1",
                "type": "logic_gate",
                "input": "ctx",
                "rules": [{"condition": "true", "next_node": "G1", "desc": "noop"}],
                "default": "G1",
                "needs": [],
            }
        ],
    )

    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=user_id,
            project_name="Update_Model_Non_Action",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="DRAFT",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

    resp = await client.patch(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/G1",
        json={"model_override": "gpt-4o"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "node_not_action"


@pytest.mark.asyncio
async def test_spec_agent_update_node_model_invalid_model(
    client, auth_tokens, AsyncSessionLocal, test_user, monkeypatch
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Update_Model_Invalid",
        nodes=[
            {
                "id": "T2",
                "type": "action",
                "instruction": "do work",
                "needs": [],
            }
        ],
    )

    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=user_id,
            project_name="Update_Model_Invalid",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="DRAFT",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

    async def fake_candidates(
        self, capability, model_id, user_id, include_public=True
    ):
        return []

    monkeypatch.setattr(ProviderModelRepository, "get_candidates", fake_candidates)

    resp = await client.patch(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T2",
        json={"model_override": "unknown-model"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "model_not_available"


@pytest.mark.asyncio
async def test_spec_agent_list_plans(client, auth_tokens, AsyncSessionLocal, test_user):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="List_Plan",
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
        for idx in range(2):
            plan = SpecPlan(
                user_id=user_id,
                project_name=f"List_Plan_{idx}",
                manifest_data=manifest.model_dump(),
                current_context={},
                execution_config={},
                status="DRAFT",
            )
            session.add(plan)
        await session.commit()

    resp = await client.get(
        "/api/v1/spec-agent/plans?size=10",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert "items" in payload
    assert len(payload["items"]) >= 2
