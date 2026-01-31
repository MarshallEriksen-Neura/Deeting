from __future__ import annotations

import asyncio
import logging
import uuid

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.assistant_repository import AssistantRepository, AssistantVersionRepository
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_store import delete_points, ensure_collection_vector_size, upsert_points

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

        version = await version_repo.get_for_assistant(assistant_id, assistant.current_version_id)
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
