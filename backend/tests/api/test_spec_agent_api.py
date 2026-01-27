from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.models.conversation import (
    ConversationChannel,
    ConversationMessage,
    ConversationSession,
    ConversationStatus,
)
from app.models.spec_agent import SpecExecutionLog, SpecPlan
from app.schemas.spec_agent import SpecManifest
from app.repositories.provider_instance_repository import ProviderModelRepository
import importlib

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

    class _FakeLLMService:
        async def chat_completion(self, *_args, **kwargs):
            return await fake_chat_completion(*_args, **kwargs)

    spec_agent_module = importlib.import_module("app.services.agent.spec_agent_service")
    monkeypatch.setattr(spec_agent_module, "llm_service", _FakeLLMService())
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
async def test_spec_agent_node_detail(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Node_Detail",
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
            project_name="Node_Detail",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="RUNNING",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

        log = SpecExecutionLog(
            plan_id=plan_id,
            node_id="T1",
            status="SUCCESS",
            input_snapshot={"id": "T1"},
            output_data={"ok": True},
            raw_response={"raw": "data"},
            started_at=Datetime.now(),
            completed_at=Datetime.now(),
        )
        session.add(log)
        await session.commit()

    resp = await client.get(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T1",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["node_id"] == "T1"
    assert payload["execution"]["status"] in ("completed", "active")


@pytest.mark.asyncio
async def test_spec_agent_update_node_instruction_waiting(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Update_Instruction",
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
            project_name="Update_Instruction",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="PAUSED",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

        log = SpecExecutionLog(
            plan_id=plan_id,
            node_id="T1",
            status="WAITING_APPROVAL",
            input_snapshot={"id": "T1"},
            started_at=Datetime.now(),
        )
        session.add(log)
        await session.commit()

    resp = await client.patch(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T1",
        json={"instruction": "new instruction"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["instruction"] == "new instruction"

    async with AsyncSessionLocal() as session:
        reloaded = await session.get(SpecPlan, plan_id)
        assert reloaded is not None
        reloaded_manifest = SpecManifest(**reloaded.manifest_data)
        node = next(item for item in reloaded_manifest.nodes if item.id == "T1")
        assert node.instruction == "new instruction"


@pytest.mark.asyncio
async def test_spec_agent_update_node_instruction_not_waiting(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Update_Instruction_Not_Waiting",
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
            project_name="Update_Instruction_Not_Waiting",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="RUNNING",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

        log = SpecExecutionLog(
            plan_id=plan_id,
            node_id="T1",
            status="SUCCESS",
            input_snapshot={"id": "T1"},
            started_at=Datetime.now(),
            completed_at=Datetime.now(),
        )
        session.add(log)
        await session.commit()

    resp = await client.patch(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T1",
        json={"instruction": "new instruction"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "node_not_waiting"


@pytest.mark.asyncio
async def test_spec_agent_update_node_instruction_running_sets_pending(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Update_Instruction_Running",
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
            project_name="Update_Instruction_Running",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="RUNNING",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

        log = SpecExecutionLog(
            plan_id=plan_id,
            node_id="T1",
            status="RUNNING",
            input_snapshot={"id": "T1"},
            started_at=Datetime.now(),
        )
        session.add(log)
        await session.commit()

    resp = await client.patch(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T1",
        json={"instruction": "queued instruction"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["pending_instruction"] == "queued instruction"

    async with AsyncSessionLocal() as session:
        reloaded = await session.get(SpecPlan, plan_id)
        assert reloaded is not None
        reloaded_manifest = SpecManifest(**reloaded.manifest_data)
        node = next(item for item in reloaded_manifest.nodes if item.id == "T1")
        assert node.pending_instruction == "queued instruction"


@pytest.mark.asyncio
async def test_spec_agent_rerun_node_applies_pending(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Rerun_Node",
        nodes=[
            {
                "id": "T1",
                "type": "action",
                "instruction": "do work",
                "pending_instruction": "updated work",
                "needs": [],
            },
            {
                "id": "T2",
                "type": "action",
                "instruction": "do more",
                "needs": ["T1"],
            },
        ],
    )

    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=user_id,
            project_name="Rerun_Node",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="COMPLETED",
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

        log = SpecExecutionLog(
            plan_id=plan_id,
            node_id="T1",
            status="SUCCESS",
            input_snapshot={"id": "T1"},
            output_data={"ok": True},
            started_at=Datetime.now(),
            completed_at=Datetime.now(),
        )
        session.add(log)
        await session.commit()

    resp = await client.post(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T1/rerun",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert "T1" in payload["queued_nodes"]

    async with AsyncSessionLocal() as session:
        reloaded = await session.get(SpecPlan, plan_id)
        assert reloaded is not None
        reloaded_manifest = SpecManifest(**reloaded.manifest_data)
        node = next(item for item in reloaded_manifest.nodes if item.id == "T1")
        assert node.instruction == "updated work"
        assert node.pending_instruction is None


@pytest.mark.asyncio
async def test_spec_agent_append_node_event(
    client, auth_tokens, AsyncSessionLocal, test_user
):
    user_id = uuid.UUID(test_user["id"])
    manifest = SpecManifest(
        spec_v="1.2",
        project_name="Event_Test",
        nodes=[
            {
                "id": "T1",
                "type": "action",
                "instruction": "do work",
                "needs": [],
            }
        ],
    )
    session_id = uuid.uuid4()

    async with AsyncSessionLocal() as session:
        session.add(
            ConversationSession(
                id=session_id,
                user_id=user_id,
                channel=ConversationChannel.INTERNAL,
                status=ConversationStatus.ACTIVE,
                last_active_at=Datetime.now(),
                message_count=0,
            )
        )
        plan = SpecPlan(
            user_id=user_id,
            project_name="Event_Test",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="RUNNING",
            conversation_session_id=session_id,
        )
        session.add(plan)
        await session.commit()
        plan_id = plan.id

    resp = await client.post(
        f"/api/v1/spec-agent/plans/{plan_id}/nodes/T1/events",
        json={"event": "rerun_prompt", "source": "auto_drawer"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "ok"

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(ConversationMessage).where(
                ConversationMessage.session_id == session_id
            )
        )
        message = result.scalars().first()
        assert message is not None
        assert message.meta_info is not None
        assert message.meta_info.get("spec_agent_event") == "rerun_prompt"
        assert message.meta_info.get("spec_agent_source") == "auto_drawer"
        assert message.meta_info.get("spec_agent_node_id") == "T1"


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
