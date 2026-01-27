from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
import pytest_asyncio

from app.models import Base
from sqlalchemy import select

from app.models.spec_agent import SpecExecutionLog, SpecPlan, SpecWorkerSession
from app.repositories.spec_agent_repository import SpecAgentRepository
from app.schemas.spec_agent import SpecManifest
from app.schemas.tool import ToolCall, ToolDefinition
import importlib

from app.services.agent import SpecAgentService, SpecExecutor
from app.utils.time_utils import Datetime
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_get_latest_logs_returns_latest_per_node():
    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=uuid4(),
            project_name="spec-latest",
            manifest_data={"spec_v": "1.2", "project_name": "spec-latest", "nodes": []},
            current_context={},
            execution_config={},
        )
        session.add(plan)
        await session.commit()

        t1 = Datetime.now()
        t2 = t1 + timedelta(seconds=10)

        session.add_all(
            [
                SpecExecutionLog(
                    plan_id=plan.id,
                    node_id="N1",
                    status="SUCCESS",
                    completed_at=t1,
                ),
                SpecExecutionLog(
                    plan_id=plan.id,
                    node_id="N1",
                    status="FAILED",
                    completed_at=t2,
                ),
                SpecExecutionLog(
                    plan_id=plan.id,
                    node_id="N2",
                    status="SUCCESS",
                    completed_at=t1,
                ),
            ]
        )
        await session.commit()

        repo = SpecAgentRepository(session)
        latest = await repo.get_latest_node_logs(plan.id)
        latest_map = {log.node_id: log for log in latest}

        assert len(latest_map) == 2
        assert latest_map["N1"].status == "FAILED"
        assert latest_map["N2"].status == "SUCCESS"


@pytest.mark.asyncio
async def test_execute_plan_restores_context_and_marks_running(monkeypatch):
    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=uuid4(),
            project_name="spec-resume",
            manifest_data={
                "spec_v": "1.2",
                "project_name": "spec-resume",
                "context": {"seed": 1},
                "nodes": [
                    {
                        "id": "T1",
                        "type": "action",
                        "instruction": "do work",
                        "output_as": "out",
                        "needs": [],
                    }
                ],
            },
            current_context={"prior": 2},
            execution_config={},
            status="DRAFT",
        )
        session.add(plan)
        await session.commit()

        log = SpecExecutionLog(
            plan_id=plan.id,
            node_id="T1",
            status="SUCCESS",
            output_data={"value": 42},
            completed_at=Datetime.now(),
        )
        session.add(log)
        await session.commit()

        service = SpecAgentService()

        async def _noop(*_args, **_kwargs):
            return None

        async def _fake_mcp_tools(*_args, **_kwargs):
            return ([], {})

        monkeypatch.setattr(service, "initialize_plugins", _noop)
        monkeypatch.setattr(service, "_load_local_tools", lambda: ([], {}))
        monkeypatch.setattr(service, "_load_mcp_tools", _fake_mcp_tools)

        executor = await service.execute_plan(session, plan.user_id, plan.id)
        reloaded = await session.get(SpecPlan, plan.id)

        assert reloaded is not None
        assert reloaded.status == "RUNNING"
        assert executor.context["seed"] == 1
        assert executor.context["prior"] == 2
        assert executor.context["out"] == {"value": 42}


@pytest.mark.asyncio
async def test_run_step_check_in_pauses_plan():
    async with AsyncSessionLocal() as session:
        manifest = SpecManifest(
            spec_v="1.2",
            project_name="spec-check-in",
            nodes=[
                {
                    "id": "T1",
                    "type": "action",
                    "instruction": "requires approval",
                    "check_in": True,
                    "needs": [],
                }
            ],
        )
        plan = SpecPlan(
            user_id=uuid4(),
            project_name="spec-check-in",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="RUNNING",
        )
        session.add(plan)
        await session.commit()

        repo = SpecAgentRepository(session)
        executor = SpecExecutor(
            plan_id=plan.id,
            manifest=manifest,
            repo=repo,
            plugin_manager=None,  # type: ignore[arg-type]
            user_id=plan.user_id,
            mcp_tools_map={},
            available_tool_defs=[],
            local_tool_handlers={},
        )

        result = await executor.run_step()
        reloaded = await session.get(SpecPlan, plan.id)
        logs = await repo.get_latest_node_logs(plan.id)

        assert result["status"] == "waiting_approval"
        assert reloaded is not None
        assert reloaded.status == "PAUSED"
        assert logs[0].status == "WAITING_APPROVAL"


@pytest.mark.asyncio
async def test_tool_call_flow_returns_json_output(monkeypatch):
    async with AsyncSessionLocal() as session:
        manifest = SpecManifest(
            spec_v="1.2",
            project_name="spec-tools",
            nodes=[
                {
                    "id": "T1",
                    "type": "action",
                    "instruction": "use tool",
                    "output_as": "result",
                    "needs": [],
                }
            ],
        )
        plan = SpecPlan(
            user_id=uuid4(),
            project_name="spec-tools",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="RUNNING",
        )
        session.add(plan)
        await session.commit()

        tool_called = {"count": 0}

        async def tool_echo(text: str):
            tool_called["count"] += 1
            return {"echo": text}

        calls = {"count": 0}

        async def fake_chat_completion(*_args, **_kwargs):
            calls["count"] += 1
            if calls["count"] == 1:
                return [ToolCall(id="1", name="tool.echo", arguments={"text": "hi"})]
            return "{\"answer\": \"ok\"}"

        spec_agent_module = importlib.import_module(
            "app.services.agent.spec_agent_service"
        )
        monkeypatch.setattr(
            spec_agent_module.llm_service,
            "chat_completion",
            fake_chat_completion,
        )

        repo = SpecAgentRepository(session)
        executor = SpecExecutor(
            plan_id=plan.id,
            manifest=manifest,
            repo=repo,
            plugin_manager=None,  # type: ignore[arg-type]
            user_id=plan.user_id,
            mcp_tools_map={},
            available_tool_defs=[
                ToolDefinition(
                    name="tool.echo",
                    description="echo",
                    input_schema={"type": "object"},
                )
            ],
            local_tool_handlers={"tool.echo": tool_echo},
        )

        result = await executor.run_step()
        logs = await repo.get_latest_node_logs(plan.id)
        latest = logs[0]
        result_sessions = await session.execute(
            select(SpecWorkerSession).where(SpecWorkerSession.log_id == latest.id)
        )
        worker_session = result_sessions.scalars().first()

        assert result["status"] == "running"
        assert tool_called["count"] == 1
        assert latest.output_data == {"answer": "ok"}
        assert executor.context["result"] == {"answer": "ok"}
        assert latest.worker_snapshot["tools_used"] == ["tool.echo"]
        assert worker_session is not None
        assert worker_session.internal_messages
        assert worker_session.thought_trace


@pytest.mark.asyncio
async def test_logic_gate_skips_unselected_branch_and_records_reason():
    async with AsyncSessionLocal() as session:
        manifest = SpecManifest(
            spec_v="1.2",
            project_name="spec-logic-gate",
            context={"check": {"value": 10}},
            nodes=[
                {
                    "id": "G1",
                    "type": "logic_gate",
                    "desc": "Gate",
                    "needs": [],
                    "input": "{{check}}",
                    "rules": [
                        {
                            "condition": "$.value >= 5",
                            "next_node": "T2",
                            "desc": "go T2",
                        }
                    ],
                    "default": "T3",
                },
                {
                    "id": "T2",
                    "type": "action",
                    "instruction": "do t2",
                    "needs": ["G1"],
                },
                {
                    "id": "T3",
                    "type": "action",
                    "instruction": "do t3",
                    "needs": ["G1"],
                },
            ],
        )
        plan = SpecPlan(
            user_id=uuid4(),
            project_name="spec-logic-gate",
            manifest_data=manifest.model_dump(),
            current_context={},
            execution_config={},
            status="RUNNING",
        )
        session.add(plan)
        await session.commit()

        repo = SpecAgentRepository(session)
        executor = SpecExecutor(
            plan_id=plan.id,
            manifest=manifest,
            repo=repo,
            plugin_manager=None,  # type: ignore[arg-type]
            user_id=plan.user_id,
            mcp_tools_map={},
            available_tool_defs=[],
            local_tool_handlers={},
        )

        result = await executor.run_step()
        logs = await repo.get_latest_node_logs(plan.id)
        log_map = {log.node_id: log for log in logs}

        assert result["status"] == "running"
        assert log_map["G1"].status == "SUCCESS"
        assert log_map["T3"].status == "SKIPPED"
        assert log_map["T3"].input_snapshot["reason"] == "logic_gate:G1"
        assert "T2" not in log_map
