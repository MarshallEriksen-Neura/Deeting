from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
import pytest_asyncio

from app.models import Base
from app.models.spec_agent import SpecPlan
from app.models.spec_knowledge import SpecKnowledgeCandidate
from app.repositories.review_repository import ReviewTaskRepository
from app.services.knowledge.spec_knowledge_service import SpecKnowledgeService, STATUS_PENDING_EVAL, STATUS_PENDING_REVIEW
from app.services.review.review_service import ReviewService
from app.utils.time_utils import Datetime
from tests.api.conftest import AsyncSessionLocal, engine


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_record_feedback_creates_candidate():
    async with AsyncSessionLocal() as session:
        plan = SpecPlan(
            user_id=uuid4(),
            project_name="spec-kb",
            manifest_data={
                "spec_v": "1.2",
                "project_name": "spec-kb",
                "nodes": [
                    {
                        "id": "T1",
                        "type": "action",
                        "instruction": "search prices",
                        "needs": [],
                    }
                ],
            },
            current_context={},
            execution_config={},
        )
        session.add(plan)
        await session.commit()

        service = SpecKnowledgeService(session)
        candidate = await service.record_feedback_event(
            user_id=plan.user_id,
            plan_id=plan.id,
            event="applied",
            payload={"success": True},
        )

        assert candidate is not None
        assert candidate.apply_count == 1
        assert candidate.positive_feedback == 1
        assert candidate.status == STATUS_PENDING_EVAL


@pytest.mark.asyncio
async def test_evaluate_candidate_static_guard_blocks():
    async with AsyncSessionLocal() as session:
        candidate = SpecKnowledgeCandidate(
            canonical_hash="hash1",
            user_id=uuid4(),
            plan_id=None,
            manifest_data={"nodes": [{"instruction": "rm -rf /"}]},
            normalized_manifest={"nodes": [{"instruction": "rm -rf /"}]},
            status=STATUS_PENDING_EVAL,
            last_positive_at=Datetime.now() - timedelta(seconds=2000),
        )
        session.add(candidate)
        await session.commit()

        service = SpecKnowledgeService(session)
        result = await service.evaluate_candidate(candidate.id)
        refreshed = await session.get(SpecKnowledgeCandidate, candidate.id)

        assert result == "static_blocked"
        assert refreshed is not None
        assert refreshed.status == "rejected"
        assert refreshed.eval_snapshot.get("static_pass") is False


@pytest.mark.asyncio
async def test_evaluate_candidate_llm_pass(monkeypatch):
    async with AsyncSessionLocal() as session:
        candidate = SpecKnowledgeCandidate(
            canonical_hash="hash2",
            user_id=uuid4(),
            plan_id=None,
            manifest_data={"nodes": [{"instruction": "do something safe"}]},
            normalized_manifest={"nodes": [{"instruction": "do something safe"}]},
            status=STATUS_PENDING_EVAL,
            last_positive_at=Datetime.now() - timedelta(seconds=2000),
        )
        session.add(candidate)
        await session.commit()

        async def fake_review(*_args, **_kwargs):
            return "{\"score\": 90, \"reason\": \"ok\"}"

        monkeypatch.setattr(
            "app.services.providers.llm.llm_service.chat_completion",
            fake_review,
        )

        service = SpecKnowledgeService(session)
        result = await service.evaluate_candidate(candidate.id)
        refreshed = await session.get(SpecKnowledgeCandidate, candidate.id)
        review_repo = ReviewTaskRepository(session)
        review_task = await review_repo.get_by_entity("spec_knowledge_candidate", candidate.id)

        assert result == "ok"
        assert refreshed is not None
        assert refreshed.status == STATUS_PENDING_REVIEW
        assert refreshed.eval_llm_score == 90
        assert review_task is not None


@pytest.mark.asyncio
async def test_promote_and_reject_candidate(monkeypatch):
    async with AsyncSessionLocal() as session:
        candidate = SpecKnowledgeCandidate(
            canonical_hash="hash3",
            user_id=uuid4(),
            plan_id=None,
            manifest_data={"nodes": [{"instruction": "safe task"}]},
            normalized_manifest={"nodes": [{"instruction": "safe task"}]},
            status=STATUS_PENDING_REVIEW,
        )
        session.add(candidate)
        await session.commit()

        review_repo = ReviewTaskRepository(session)
        review_service = ReviewService(review_repo)
        await review_service.submit(
            entity_type="spec_knowledge_candidate",
            entity_id=candidate.id,
            submitter_user_id=candidate.user_id,
            payload={"canonical_hash": candidate.canonical_hash},
        )

        reject_candidate = SpecKnowledgeCandidate(
            canonical_hash="hash4",
            user_id=uuid4(),
            plan_id=None,
            manifest_data={"nodes": [{"instruction": "another safe task"}]},
            normalized_manifest={"nodes": [{"instruction": "another safe task"}]},
            status=STATUS_PENDING_REVIEW,
        )
        session.add(reject_candidate)
        await session.commit()
        await review_service.submit(
            entity_type="spec_knowledge_candidate",
            entity_id=reject_candidate.id,
            submitter_user_id=reject_candidate.user_id,
            payload={"canonical_hash": reject_candidate.canonical_hash},
        )

        async def noop_upsert(*_args, **_kwargs):
            return True

        monkeypatch.setattr(
            "app.services.knowledge.spec_knowledge_service.SpecKnowledgeVectorService.upsert_system",
            noop_upsert,
        )

        service = SpecKnowledgeService(session)
        promoted = await service.promote_candidate(candidate.id, auto=False, reason="ok")
        refreshed = await session.get(SpecKnowledgeCandidate, candidate.id)

        assert promoted is True
        assert refreshed is not None
        assert refreshed.status == "approved"

        rejected = await service.reject_candidate(reject_candidate.id, reason="nope")
        refreshed = await session.get(SpecKnowledgeCandidate, reject_candidate.id)

        assert rejected is True
        assert refreshed is not None
        assert refreshed.status == "rejected"
