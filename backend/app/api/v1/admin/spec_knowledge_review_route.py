"""
Spec Knowledge 审核 API (/api/v1/admin/spec-knowledge-candidates)
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.repositories.review_repository import ReviewTaskRepository
from app.repositories.spec_knowledge_repository import SpecKnowledgeCandidateRepository
from app.schemas.spec_knowledge import (
    SpecKnowledgeCandidateDTO,
    SpecKnowledgeReviewDecisionRequest,
    SpecKnowledgeUsageStats,
    SpecKnowledgeEvalSnapshot,
)
from app.services.knowledge.spec_knowledge_service import (
    SPEC_KB_REVIEW_ENTITY,
    SpecKnowledgeService,
)

router = APIRouter(
    prefix="/admin/spec-knowledge-candidates",
    tags=["Admin - Spec Knowledge"],
)


def get_candidate_repo(db: AsyncSession = Depends(get_db)) -> SpecKnowledgeCandidateRepository:
    return SpecKnowledgeCandidateRepository(db)


def get_review_repo(db: AsyncSession = Depends(get_db)) -> ReviewTaskRepository:
    return ReviewTaskRepository(db)


def get_spec_kb_service(db: AsyncSession = Depends(get_db)) -> SpecKnowledgeService:
    return SpecKnowledgeService(db)


async def _build_candidate_dto(
    candidate,
    review_repo: ReviewTaskRepository,
) -> SpecKnowledgeCandidateDTO:
    review_task = await review_repo.get_by_entity(SPEC_KB_REVIEW_ENTITY, candidate.id)
    manifest = candidate.manifest_data or {}
    usage_stats = SpecKnowledgeUsageStats(
        positive_feedback=candidate.positive_feedback,
        negative_feedback=candidate.negative_feedback,
        apply_count=candidate.apply_count,
        revert_count=candidate.revert_count,
        error_count=candidate.error_count,
        total_runs=candidate.total_runs,
        success_runs=candidate.success_runs,
        success_rate=(
            (candidate.success_runs / candidate.total_runs)
            if candidate.total_runs
            else 0.0
        ),
        unique_sessions=len(candidate.session_hashes or []),
    )
    eval_snapshot = SpecKnowledgeEvalSnapshot(
        static_pass=candidate.eval_static_pass,
        llm_score=candidate.eval_llm_score,
        critic_reason=candidate.eval_reason,
    )
    return SpecKnowledgeCandidateDTO(
        id=candidate.id,
        canonical_hash=candidate.canonical_hash,
        status=candidate.status,
        plan_id=candidate.plan_id,
        user_id=candidate.user_id,
        project_name=manifest.get("project_name"),
        usage_stats=usage_stats,
        eval_snapshot=eval_snapshot,
        review_status=review_task.status if review_task else None,
        last_positive_at=candidate.last_positive_at,
        last_negative_at=candidate.last_negative_at,
        last_eval_at=candidate.last_eval_at,
        promoted_at=candidate.promoted_at,
        created_at=candidate.created_at,
        updated_at=candidate.updated_at,
    )


@router.get(
    "",
    response_model=CursorPage[SpecKnowledgeCandidateDTO],
    dependencies=[Depends(get_current_superuser)],
)
async def list_spec_kb_candidates(
    params: CursorParams = Depends(),
    status_filter: str | None = Query(None, description="候选状态过滤"),
    repo: SpecKnowledgeCandidateRepository = Depends(get_candidate_repo),
    review_repo: ReviewTaskRepository = Depends(get_review_repo),
) -> CursorPage[SpecKnowledgeCandidateDTO]:
    stmt = repo.build_query(status=status_filter)
    page = await paginate(repo.session, stmt, params=params)
    items = [await _build_candidate_dto(item, review_repo) for item in page.items]
    return page.copy(update={"items": items})


@router.post(
    "/{candidate_id}/approve",
    response_model=SpecKnowledgeCandidateDTO,
    dependencies=[Depends(get_current_superuser)],
)
async def approve_spec_kb_candidate(
    candidate_id: UUID,
    payload: SpecKnowledgeReviewDecisionRequest,
    service: SpecKnowledgeService = Depends(get_spec_kb_service),
    repo: SpecKnowledgeCandidateRepository = Depends(get_candidate_repo),
    review_repo: ReviewTaskRepository = Depends(get_review_repo),
) -> SpecKnowledgeCandidateDTO:
    candidate = await repo.get(candidate_id)
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="candidate_not_found")
    promoted = await service.promote_candidate(
        candidate_id,
        reviewer_user_id=None,
        reason=payload.reason,
        auto=False,
    )
    if not promoted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="candidate_not_promotable"
        )
    return await _build_candidate_dto(candidate, review_repo)


@router.post(
    "/{candidate_id}/reject",
    response_model=SpecKnowledgeCandidateDTO,
    dependencies=[Depends(get_current_superuser)],
)
async def reject_spec_kb_candidate(
    candidate_id: UUID,
    payload: SpecKnowledgeReviewDecisionRequest,
    service: SpecKnowledgeService = Depends(get_spec_kb_service),
    repo: SpecKnowledgeCandidateRepository = Depends(get_candidate_repo),
    review_repo: ReviewTaskRepository = Depends(get_review_repo),
) -> SpecKnowledgeCandidateDTO:
    candidate = await repo.get(candidate_id)
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="candidate_not_found")
    rejected = await service.reject_candidate(
        candidate_id,
        reviewer_user_id=None,
        reason=payload.reason,
    )
    if not rejected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="candidate_not_rejectable"
        )
    return await _build_candidate_dto(candidate, review_repo)
