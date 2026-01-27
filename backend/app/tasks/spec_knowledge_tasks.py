import asyncio
import logging
import uuid

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.knowledge.spec_knowledge_service import SpecKnowledgeService

logger = logging.getLogger(__name__)


async def _run_evaluation(candidate_id: uuid.UUID) -> str:
    async with AsyncSessionLocal() as session:
        service = SpecKnowledgeService(session)
        result = await service.evaluate_candidate(candidate_id)
        return result


@celery_app.task(queue="agent_tasks", name="app.tasks.spec_knowledge.evaluate_candidate")
def evaluate_candidate(candidate_id: str) -> str:
    try:
        return asyncio.run(_run_evaluation(uuid.UUID(candidate_id)))
    except Exception as exc:
        logger.exception("spec_kb_evaluate_failed: %s", exc)
        return "failed"


async def _run_auto_promote(candidate_id: uuid.UUID) -> bool:
    async with AsyncSessionLocal() as session:
        service = SpecKnowledgeService(session)
        return await service.promote_candidate(candidate_id, auto=True)


@celery_app.task(queue="agent_tasks", name="app.tasks.spec_knowledge.auto_promote_candidate")
def auto_promote_candidate(candidate_id: str) -> str:
    try:
        promoted = asyncio.run(_run_auto_promote(uuid.UUID(candidate_id)))
        return "promoted" if promoted else "skipped"
    except Exception as exc:
        logger.exception("spec_kb_auto_promote_failed: %s", exc)
        return "failed"
