from __future__ import annotations

import asyncio
import logging
import uuid

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.assistant_repository import (
    AssistantRepository,
    AssistantVersionRepository,
)
from app.services.providers.embedding import EmbeddingService
from app.services.notifications.task_notification import push_task_progress
from app.storage.qdrant_kb_store import (
    delete_points,
    ensure_collection_vector_size,
    upsert_points,
)

logger = logging.getLogger(__name__)

ASSISTANT_COLLECTION_NAME = "expert_network"


def _extract_tools(skill_refs: list) -> list[str]:
    tools: list[str] = []
    for ref in skill_refs or []:
        if isinstance(ref, dict):
            value = (
                ref.get("skill_id")
                or ref.get("id")
                or ref.get("name")
                or ref.get("tool")
                or ref.get("slug")
            )
            if value:
                tools.append(str(value))
            continue
        tools.append(str(ref))
    return tools


def _build_embedding_text(assistant, version) -> str:
    parts = [
        version.name,
        assistant.summary,
        version.description,
        " ".join(version.tags or []),
        version.system_prompt,
    ]
    cleaned = [str(part).strip() for part in parts if part]
    return "\n".join([part for part in cleaned if part])


async def _run_sync_assistant(assistant_id: uuid.UUID) -> str:
    if not qdrant_is_configured():
        return "skipped"

    async with AsyncSessionLocal() as session:
        assistant_repo = AssistantRepository(session)
        version_repo = AssistantVersionRepository(session)
        assistant = await assistant_repo.get(assistant_id)
        if not assistant or not assistant.current_version_id:
            return "missing_assistant"

        version = await version_repo.get_for_assistant(
            assistant_id, assistant.current_version_id
        )
        if not version:
            return "missing_version"

        text = _build_embedding_text(assistant, version)
        if not text:
            return "empty_text"

        embedding_service = EmbeddingService()
        vectors = await embedding_service.embed_documents([text])
        if not vectors:
            return "skipped"

        vector = vectors[0]
        payload = {
            "uuid": str(assistant.id),
            "assistant_id": str(assistant.id),
            "version_id": str(version.id),
            "name": version.name,
            "summary": assistant.summary,
            "tags": version.tags or [],
            "tools": _extract_tools(version.skill_refs),
            "embedding_model": embedding_service.model,
        }

        client = get_qdrant_client()
        await ensure_collection_vector_size(
            client,
            collection_name=ASSISTANT_COLLECTION_NAME,
            vector_size=len(vector),
        )
        await upsert_points(
            client,
            collection_name=ASSISTANT_COLLECTION_NAME,
            points=[
                {
                    "id": str(assistant.id),
                    "vector": vector,
                    "payload": payload,
                }
            ],
            wait=True,
        )
        return "upserted"


async def _run_remove_assistant(assistant_id: uuid.UUID) -> str:
    if not qdrant_is_configured():
        return "skipped"

    client = get_qdrant_client()
    await delete_points(
        client,
        collection_name=ASSISTANT_COLLECTION_NAME,
        points_ids=[str(assistant_id)],
        wait=True,
    )
    return "removed"


@celery_app.task(name="assistant.sync_to_qdrant")
def sync_assistant_to_qdrant(assistant_id: str) -> str:
    try:
        return asyncio.run(_run_sync_assistant(uuid.UUID(assistant_id)))
    except Exception as exc:
        logger.exception("assistant_sync_to_qdrant_failed: %s", exc)
        return "failed"


@celery_app.task(name="assistant.remove_from_qdrant")
def remove_assistant_from_qdrant(assistant_id: str) -> str:
    try:
        return asyncio.run(_run_remove_assistant(uuid.UUID(assistant_id)))
    except Exception as exc:
        logger.exception("assistant_remove_from_qdrant_failed: %s", exc)
        return "failed"


async def _run_assistant_onboarding(url: str, user_id: str | None = None) -> dict:
    from app.repositories.knowledge_repository import KnowledgeRepository
    from app.services.assistant.assistant_ingestion_service import (
        AssistantIngestionService,
    )
    from app.services.assistant.assistant_service import AssistantService
    from app.services.knowledge.crawler_knowledge_service import (
        CrawlerKnowledgeService,
    )

    job_id = str(uuid.uuid4())[:8]
    await push_task_progress(
        user_id, job_id, "initialization", "正在初始化助手性格分析引擎...", percentage=10
    )

    async with AsyncSessionLocal() as session:
        knowledge_repo = KnowledgeRepository(session)
        assistant_service = AssistantService(
            AssistantRepository(session), AssistantVersionRepository(session)
        )
        crawler_service = CrawlerKnowledgeService(knowledge_repo)
        ingestion_service = AssistantIngestionService(assistant_service, knowledge_repo)

        # 1. Crawl (shallow crawl for onboarding)
        await push_task_progress(
            user_id, job_id, "crawling", f"正在抓取网页内容：{url}...", percentage=30
        )
        crawl_result = await crawler_service.ingest_deep_dive(
            seed_url=url, max_depth=1, max_pages=1, artifact_type="assistant"
        )

        review_ids = crawl_result.get("review_ids", [])
        if not review_ids:
            await push_task_progress(
                user_id, job_id, "error", "网页抓取失败，请检查链接是否有效。", status="failed"
            )
            raise ValueError(f"Failed to crawl content from {url}")

        # 2. Refine & Create (Use the first artifact)
        await push_task_progress(
            user_id, job_id, "refining", "正在解析网页中的性格特征与指令...", percentage=60
        )
        artifact_id = uuid.UUID(review_ids[0])
        resolved_user_id = None
        if user_id:
            try:
                resolved_user_id = uuid.UUID(user_id)
            except ValueError:
                logger.warning("Invalid user_id for assistant onboarding: %s", user_id)
        result = await ingestion_service.refine_and_create_assistant(
            artifact_id,
            user_id=resolved_user_id,
        )
        await session.commit()

        await push_task_progress(
            user_id, job_id, "completed", f"助手 '{result.get('name')}' 已成功创建并发布！", status="completed", percentage=100
        )
        return result


@celery_app.task(name="assistant.run_onboarding")
def run_assistant_onboarding(url: str, user_id: str | None = None) -> dict | str:
    try:
        return asyncio.run(_run_assistant_onboarding(url, user_id=user_id))
    except Exception as exc:
        logger.exception("assistant_run_onboarding_failed: %s", exc)
        return "failed"
