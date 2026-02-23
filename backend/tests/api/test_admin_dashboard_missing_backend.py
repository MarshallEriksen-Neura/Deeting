from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient

from app.models import (
    BillingTransaction,
    ConversationMessage,
    ConversationSession,
    ConversationSummary,
    GatewayLog,
    GenerationTask,
    ImageGenerationOutput,
    ImageGenerationShare,
    KnowledgeArtifact,
    KnowledgeChunk,
    Notification,
    NotificationLevel,
    NotificationType,
    SpecExecutionLog,
    SpecPlan,
    SpecWorkerSession,
    TenantQuota,
    TransactionStatus,
    TransactionType,
    User,
)
from app.utils.time_utils import Datetime


async def _get_user_id(async_session_local, email: str) -> uuid.UUID:
    from sqlalchemy import select

    async with async_session_local() as session:
        row = await session.execute(select(User).where(User.email == email))
        user = row.scalar_one()
        return user.id


@pytest.mark.asyncio
async def test_admin_conversation_endpoints(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
):
    user_id = await _get_user_id(AsyncSessionLocal, "testuser@example.com")
    session_id = uuid.uuid4()

    async with AsyncSessionLocal() as session:
        conv = ConversationSession(
            id=session_id,
            user_id=user_id,
            channel="internal",
            status="active",
            title="admin-test-conv",
            message_count=2,
            first_message_at=Datetime.now() - timedelta(minutes=10),
            last_active_at=Datetime.now(),
            last_summary_version=1,
        )
        session.add(conv)
        session.add_all(
            [
                ConversationMessage(
                    id=uuid.uuid4(),
                    session_id=session_id,
                    turn_index=1,
                    role="user",
                    content="hello",
                    token_estimate=10,
                ),
                ConversationMessage(
                    id=uuid.uuid4(),
                    session_id=session_id,
                    turn_index=2,
                    role="assistant",
                    content="world",
                    token_estimate=12,
                ),
            ]
        )
        session.add(
            ConversationSummary(
                id=uuid.uuid4(),
                session_id=session_id,
                version=1,
                summary_text="summary",
                covered_from_turn=1,
                covered_to_turn=2,
                token_estimate=8,
            )
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

    resp = await client.get("/api/v1/admin/conversations", headers=headers)
    assert resp.status_code == 200
    assert any(item["id"] == str(session_id) for item in resp.json()["items"])

    resp = await client.get(f"/api/v1/admin/conversations/{session_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["title"] == "admin-test-conv"

    resp = await client.get(
        f"/api/v1/admin/conversations/{session_id}/messages",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 2

    resp = await client.get(
        f"/api/v1/admin/conversations/{session_id}/summaries",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["items"][0]["version"] == 1

    resp = await client.post(
        f"/api/v1/admin/conversations/{session_id}/archive",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "archived"

    resp = await client.post(
        f"/api/v1/admin/conversations/{session_id}/close",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "closed"


@pytest.mark.asyncio
async def test_admin_spec_plan_endpoints(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
):
    user_id = await _get_user_id(AsyncSessionLocal, "testuser@example.com")
    plan_id = uuid.uuid4()
    log_id = uuid.uuid4()

    async with AsyncSessionLocal() as session:
        session.add(
            SpecPlan(
                id=plan_id,
                user_id=user_id,
                project_name="admin-spec-plan",
                manifest_data={"spec_v": "1.2", "project_name": "admin", "nodes": []},
                current_context={},
                execution_config={},
                status="RUNNING",
            )
        )
        session.add(
            SpecExecutionLog(
                id=log_id,
                plan_id=plan_id,
                node_id="T1",
                status="SUCCESS",
                output_data={"ok": True},
            )
        )
        session.add(
            SpecWorkerSession(
                id=uuid.uuid4(),
                log_id=log_id,
                internal_messages=[{"role": "assistant", "content": "done"}],
                thought_trace=[{"step": 1, "summary": "ok"}],
                total_tokens=22,
            )
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

    resp = await client.get("/api/v1/admin/spec-plans", headers=headers)
    assert resp.status_code == 200
    assert any(item["id"] == str(plan_id) for item in resp.json()["items"])

    resp = await client.get(f"/api/v1/admin/spec-plans/{plan_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["project_name"] == "admin-spec-plan"

    resp = await client.get(f"/api/v1/admin/spec-plans/{plan_id}/logs", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["items"][0]["node_id"] == "T1"

    resp = await client.get(f"/api/v1/admin/spec-logs/{log_id}/sessions", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["items"][0]["total_tokens"] == 22

    resp = await client.post(f"/api/v1/admin/spec-plans/{plan_id}/pause", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "PAUSED"

    resp = await client.post(f"/api/v1/admin/spec-plans/{plan_id}/resume", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "RUNNING"


@pytest.mark.asyncio
async def test_admin_generation_endpoints(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
):
    user_id = await _get_user_id(AsyncSessionLocal, "testuser@example.com")
    task_id = uuid.uuid4()
    share_id = uuid.uuid4()

    async with AsyncSessionLocal() as session:
        session.add(
            GenerationTask(
                id=task_id,
                user_id=user_id,
                model="gpt-image-1",
                task_type="image_generation",
                input_params={},
                output_meta={},
                prompt_raw="draw a cat",
                prompt_hash="hash-1",
                status="succeeded",
                width=512,
                height=512,
                cost_upstream=0.3,
                cost_user=0.5,
            )
        )
        session.add(
            ImageGenerationOutput(
                id=uuid.uuid4(),
                task_id=task_id,
                output_index=0,
                source_url="https://example.com/output.png",
                content_type="image/png",
                size_bytes=1024,
                width=512,
                height=512,
            )
        )
        session.add(
            ImageGenerationShare(
                id=share_id,
                task_id=task_id,
                user_id=user_id,
                model="gpt-image-1",
                prompt="draw a cat",
                shared_at=Datetime.now(),
                is_active=True,
            )
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

    resp = await client.get("/api/v1/admin/generation-tasks", headers=headers)
    assert resp.status_code == 200
    assert any(item["id"] == str(task_id) for item in resp.json()["items"])

    resp = await client.get(f"/api/v1/admin/generation-tasks/{task_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["model"] == "gpt-image-1"

    resp = await client.get(
        f"/api/v1/admin/generation-tasks/{task_id}/outputs",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["items"][0]["content_type"] == "image/png"

    resp = await client.get("/api/v1/admin/generation-shares", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1

    resp = await client.patch(
        f"/api/v1/admin/generation-shares/{share_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


@pytest.mark.asyncio
async def test_admin_billing_endpoints(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
):
    tenant_id = uuid.uuid4()
    tx_id = uuid.uuid4()

    async with AsyncSessionLocal() as session:
        session.add(
            TenantQuota(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                balance=Decimal("10.0"),
                credit_limit=Decimal("2.0"),
                daily_quota=100,
                monthly_quota=1000,
                rpm_limit=60,
                tpm_limit=60000,
                token_quota=100000,
                is_active=True,
            )
        )
        session.add(
            BillingTransaction(
                id=tx_id,
                tenant_id=tenant_id,
                trace_id=f"trace-{uuid.uuid4().hex[:10]}",
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("1.5"),
                input_tokens=100,
                output_tokens=50,
                input_price=Decimal("0"),
                output_price=Decimal("0"),
                balance_before=Decimal("10.0"),
                balance_after=Decimal("8.5"),
                model="gpt-4o-mini",
                provider="openai",
                description="test tx",
            )
        )
        session.add(
            GatewayLog(
                id=uuid.uuid4(),
                model="gpt-4o-mini",
                status_code=200,
                duration_ms=120,
                cost_upstream=0.4,
                cost_user=0.5,
                created_at=Datetime.now(),
            )
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

    resp = await client.get("/api/v1/admin/quotas", headers=headers)
    assert resp.status_code == 200
    assert any(item["tenant_id"] == str(tenant_id) for item in resp.json()["items"])

    resp = await client.get(f"/api/v1/admin/quotas/{tenant_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["balance"] == 10.0

    resp = await client.patch(
        f"/api/v1/admin/quotas/{tenant_id}",
        headers=headers,
        json={"rpm_limit": 120},
    )
    assert resp.status_code == 200
    assert resp.json()["rpm_limit"] == 120

    resp = await client.post(
        f"/api/v1/admin/quotas/{tenant_id}/adjust",
        headers=headers,
        json={"amount": 2.5, "reason": "manual recharge"},
    )
    assert resp.status_code == 200
    assert resp.json()["type"] in {"recharge", "adjust"}

    resp = await client.get("/api/v1/admin/billing/transactions", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1

    resp = await client.get(
        f"/api/v1/admin/billing/transactions/{tx_id}",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == str(tx_id)

    resp = await client.get("/api/v1/admin/billing/summary", headers=headers)
    assert resp.status_code == 200
    assert "profit" in resp.json()


@pytest.mark.asyncio
async def test_admin_gateway_logs_endpoints(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
):
    log_id = uuid.uuid4()
    model_name = f"admin-log-model-{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as session:
        session.add_all(
            [
                GatewayLog(
                    id=log_id,
                    model=model_name,
                    status_code=500,
                    duration_ms=800,
                    error_code="UPSTREAM_ERROR",
                    is_cached=False,
                    cost_upstream=0.2,
                    cost_user=0.3,
                    created_at=Datetime.now(),
                ),
                GatewayLog(
                    id=uuid.uuid4(),
                    model=model_name,
                    status_code=200,
                    duration_ms=100,
                    is_cached=True,
                    cost_upstream=0.1,
                    cost_user=0.2,
                    created_at=Datetime.now(),
                ),
                GatewayLog(
                    id=uuid.uuid4(),
                    model=model_name,
                    status_code=0,
                    duration_ms=320,
                    error_code="UPSTREAM_TIMEOUT",
                    is_cached=False,
                    cost_upstream=0.15,
                    cost_user=0.16,
                    created_at=Datetime.now(),
                ),
            ]
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}
    resp = await client.get("/api/v1/admin/gateway-logs", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 3

    resp = await client.get("/api/v1/admin/gateway-logs/stats", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 3
    assert isinstance(resp.json()["error_distribution"], list)

    resp = await client.get(
        "/api/v1/admin/gateway-logs/stats",
        headers=headers,
        params={"model": model_name},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert data["success_rate"] == pytest.approx(33.33, abs=0.01)
    assert any(bucket["key"] == "UPSTREAM_TIMEOUT" for bucket in data["error_distribution"])

    resp = await client.get(f"/api/v1/admin/gateway-logs/{log_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["error_code"] == "UPSTREAM_ERROR"


@pytest.mark.asyncio
async def test_admin_knowledge_and_plugin_endpoints(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
):
    artifact_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        session.add(
            KnowledgeArtifact(
                id=artifact_id,
                source_url=f"https://docs.example.com/{uuid.uuid4().hex[:8]}",
                title="Admin Knowledge",
                raw_content="# hello",
                content_hash=uuid.uuid4().hex,
                artifact_type="documentation",
                status="pending",
            )
        )
        session.add(
            KnowledgeChunk(
                id=uuid.uuid4(),
                artifact_id=artifact_id,
                chunk_index=0,
                text_content="chunk text",
                metadata_summary={},
            )
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

    resp = await client.get("/api/v1/admin/knowledge/artifacts", headers=headers)
    assert resp.status_code == 200
    assert any(item["id"] == str(artifact_id) for item in resp.json()["items"])

    resp = await client.get(
        f"/api/v1/admin/knowledge/artifacts/{artifact_id}",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["chunk_count"] >= 1

    resp = await client.get("/api/v1/admin/plugins", headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert isinstance(items, list)

    loaded = next((item for item in items if item["status"] == "loaded"), None)
    if loaded:
        plugin_id = loaded["id"]
        detail = await client.get(f"/api/v1/admin/plugins/{plugin_id}", headers=headers)
        assert detail.status_code == 200
        reload_resp = await client.post(
            f"/api/v1/admin/plugins/{plugin_id}/reload",
            headers=headers,
        )
        assert reload_resp.status_code == 200
        assert reload_resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_admin_notification_endpoints(
    client: AsyncClient,
    admin_tokens: dict,
    AsyncSessionLocal,
):
    notify_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        session.add_all(
            [
                Notification(
                    id=notify_id,
                    title="Admin Notification",
                    content="hello admin",
                    type=NotificationType.SYSTEM,
                    level=NotificationLevel.INFO,
                    source="admin-test",
                    payload={"k": "v"},
                    is_active=True,
                ),
                Notification(
                    id=uuid.uuid4(),
                    title="Security Alert",
                    content="security issue",
                    type=NotificationType.SECURITY,
                    level=NotificationLevel.ERROR,
                    source="security-service",
                    payload={},
                    is_active=True,
                ),
            ]
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

    resp = await client.get("/api/v1/admin/notifications?limit=20", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 2
    assert any(item["id"] == str(notify_id) for item in body["items"])

    resp = await client.get(
        "/api/v1/admin/notifications?type=security&limit=20",
        headers=headers,
    )
    assert resp.status_code == 200
    assert all(item["type"] == "security" for item in resp.json()["items"])
