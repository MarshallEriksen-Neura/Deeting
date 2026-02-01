from __future__ import annotations

import asyncio
import logging

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_store import ensure_collection_vector_size, upsert_points

logger = logging.getLogger(__name__)

SKILL_COLLECTION_NAME = "skill_registry"


def _build_embedding_text(skill) -> str:
    max_manifest_length = 800
    manifest_summary = ""
    manifest = getattr(skill, "manifest_json", None)
    if isinstance(manifest, dict) and manifest:
        capabilities = manifest.get("capabilities")
        if isinstance(capabilities, (list, tuple, set)):
            capability_items = []
            for item in capabilities:
                if item is None:
                    continue
                text = str(item).strip()
                if text:
                    capability_items.append(text)
            if capability_items:
                manifest_summary = " ".join(capability_items)
        elif capabilities is not None:
            text = str(capabilities).strip()
            if text:
                manifest_summary = text
    elif isinstance(manifest, str) and manifest.strip():
        manifest_summary = manifest.strip()

    if manifest_summary and len(manifest_summary) > max_manifest_length:
        manifest_summary = manifest_summary[:max_manifest_length].rstrip()

    description = getattr(skill, "description", None)
    if description is not None:
        description = str(description).strip()
        if len(description) > max_manifest_length:
            description = description[:max_manifest_length].rstrip()

    parts = [
        skill.id,
        skill.name,
        skill.status,
        description,
        manifest_summary,
    ]
    cleaned = [str(part).strip() for part in parts if part]
    return "\n".join([part for part in cleaned if part])


async def _run_sync_skill(skill_id: str) -> str:
    if not qdrant_is_configured():
        return "skipped"

    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        skill = await repo.get_by_id(skill_id)
        if not skill:
            return "missing_skill"

        text = _build_embedding_text(skill)
        if not text:
            return "empty_text"

        embedding_service = EmbeddingService()
        vectors = await embedding_service.embed_documents([text])
        if not vectors:
            return "skipped"

        vector = vectors[0]
        payload = {
            "skill_id": skill.id,
            "name": skill.name,
            "status": skill.status,
            "embedding_model": embedding_service.model,
        }
        optional_payload = {
            "runtime": getattr(skill, "runtime", None),
            "risk_level": getattr(skill, "risk_level", None),
            "source_repo": getattr(skill, "source_repo", None),
        }
        payload.update({key: value for key, value in optional_payload.items() if value is not None})

        client = get_qdrant_client()
        await ensure_collection_vector_size(
            client,
            collection_name=SKILL_COLLECTION_NAME,
            vector_size=len(vector),
        )
        await upsert_points(
            client,
            collection_name=SKILL_COLLECTION_NAME,
            points=[
                {
                    "id": skill.id,
                    "vector": vector,
                    "payload": payload,
                }
            ],
            wait=True,
        )
        return "upserted"


@celery_app.task(name="skill_registry.sync_to_qdrant")
def sync_skill_to_qdrant(skill_id: str) -> str:
    try:
        return asyncio.run(_run_sync_skill(skill_id))
    except Exception as exc:
        logger.exception("skill_registry_sync_to_qdrant_failed: %s", exc)
        return "failed"
