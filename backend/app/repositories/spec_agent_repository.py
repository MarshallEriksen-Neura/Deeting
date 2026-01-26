from __future__ import annotations

import uuid
from typing import List, Optional, Dict, Any

from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.spec_agent import SpecPlan, SpecExecutionLog, SpecWorkerSession
from app.utils.time_utils import Datetime

class SpecAgentRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    # ==========================================
    # Plan Management
    # ==========================================
    async def create_plan(
        self,
        user_id: uuid.UUID,
        project_name: str,
        manifest_data: Dict[str, Any],
        priority: int = 0
    ) -> SpecPlan:
        plan = SpecPlan(
            user_id=user_id,
            project_name=project_name,
            manifest_data=manifest_data,
            priority=priority,
            status="DRAFT",
            version=1
        )
        self.session.add(plan)
        await self.session.flush()
        await self.session.refresh(plan)
        return plan

    async def get_plan(self, plan_id: uuid.UUID) -> Optional[SpecPlan]:
        return await self.session.get(SpecPlan, plan_id)

    async def update_plan_status(self, plan_id: uuid.UUID, status: str) -> None:
        stmt = update(SpecPlan).where(SpecPlan.id == plan_id).values(status=status)
        await self.session.execute(stmt)

    async def update_plan_context(self, plan_id: uuid.UUID, context: Dict[str, Any]) -> None:
        """Fully replace or merge context. Here we assume replace or caller handles merge."""
        stmt = update(SpecPlan).where(SpecPlan.id == plan_id).values(current_context=context)
        await self.session.execute(stmt)

    # ==========================================
    # Execution Log (State Machine)
    # ==========================================
    async def init_node_execution(
        self, 
        plan_id: uuid.UUID, 
        node_id: str, 
        input_snapshot: Dict[str, Any],
        worker_info: str = "generic_worker"
    ) -> SpecExecutionLog:
        """
        Creates a new log entry for a node start.
        Checks if one exists first? Usually we create new attempts if retrying.
        For simplicity, we create a new one.
        """
        log = SpecExecutionLog(
            plan_id=plan_id,
            node_id=node_id,
            status="RUNNING",
            input_snapshot=input_snapshot,
            worker_info=worker_info,
            started_at=Datetime.now()
        )
        self.session.add(log)
        await self.session.flush()
        await self.session.refresh(log)
        return log

    async def finish_node_execution(
        self,
        log_id: uuid.UUID,
        status: str, # SUCCESS, FAILED, WAITING_APPROVAL
        output_data: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
        raw_response: Optional[Any] = None,
        worker_snapshot: Optional[Dict[str, Any]] = None,
    ) -> None:
        values = {
            "status": status,
            "completed_at": Datetime.now()
        }
        if output_data is not None:
            values["output_data"] = output_data
        if error_message is not None:
            values["error_message"] = error_message
        if raw_response is not None:
            values["raw_response"] = raw_response
        if worker_snapshot is not None:
            values["worker_snapshot"] = worker_snapshot

        stmt = update(SpecExecutionLog).where(SpecExecutionLog.id == log_id).values(**values)
        await self.session.execute(stmt)

    async def get_latest_node_logs(self, plan_id: uuid.UUID) -> List[SpecExecutionLog]:
        """
        Get the latest log entry for each node in the plan.
        Useful for rebuilding context or UI display.
        """
        latest_ts = func.coalesce(
            SpecExecutionLog.completed_at, SpecExecutionLog.created_at
        )
        subq = (
            select(
                SpecExecutionLog.node_id.label("node_id"),
                func.max(latest_ts).label("latest_ts"),
            )
            .where(SpecExecutionLog.plan_id == plan_id)
            .group_by(SpecExecutionLog.node_id)
            .subquery()
        )

        stmt = (
            select(SpecExecutionLog)
            .join(
                subq,
                (SpecExecutionLog.node_id == subq.c.node_id)
                & (latest_ts == subq.c.latest_ts),
            )
            .where(SpecExecutionLog.plan_id == plan_id)
            .order_by(latest_ts.desc(), SpecExecutionLog.node_id.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_pending_nodes(self, plan_id: uuid.UUID) -> List[SpecExecutionLog]:
        """Find nodes that are PENDING or WAITING_APPROVAL"""
        latest_logs = await self.get_latest_node_logs(plan_id)
        return [
            log
            for log in latest_logs
            if log.status in ("PENDING", "WAITING_APPROVAL")
        ]

    async def mark_node_skipped(
        self,
        plan_id: uuid.UUID,
        node_id: str,
        reason: Optional[str] = None,
    ) -> SpecExecutionLog:
        log = SpecExecutionLog(
            plan_id=plan_id,
            node_id=node_id,
            status="SKIPPED",
            input_snapshot={"reason": reason} if reason else None,
            started_at=Datetime.now(),
            completed_at=Datetime.now(),
        )
        self.session.add(log)
        await self.session.flush()
        await self.session.refresh(log)
        return log

    # ==========================================
    # Worker Session (CoT Trace)
    # ==========================================
    async def create_session(self, log_id: uuid.UUID) -> SpecWorkerSession:
        session = SpecWorkerSession(log_id=log_id)
        self.session.add(session)
        await self.session.flush()
        await self.session.refresh(session)
        return session

    async def append_session_thought(self, session_id: uuid.UUID, thought_step: Dict[str, Any]) -> None:
        """
        Appends a step to the thought_trace. 
        Note: JSONB append can be tricky in generic SQL, we might need to read-modify-write if not using specific PG operators.
        For safety/compatibility, we read-modify-write here or trust the session object is attached.
        """
        session = await self.session.get(SpecWorkerSession, session_id)
        if session:
            # Create a new list to ensure SQLAlchemy detects change
            current_trace = list(session.thought_trace) if session.thought_trace else []
            current_trace.append(thought_step)
            session.thought_trace = current_trace
            # session.total_tokens += ... (if we had token usage)
            
            # Auto-save is handled by flush/commit at upper layer usually, 
            # but here we might want to be explicit if streaming.

    async def append_session_message(self, session_id: uuid.UUID, message: Dict[str, Any]) -> None:
        session = await self.session.get(SpecWorkerSession, session_id)
        if session:
            current_messages = list(session.internal_messages) if session.internal_messages else []
            current_messages.append(message)
            session.internal_messages = current_messages
