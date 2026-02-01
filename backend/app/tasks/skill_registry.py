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
    manifest_summary = ""
    manifest = getattr(skill, "manifest_json", None)
    if isinstance(manifest, dict) and manifest:
        summary_parts: list[str] = []
        capabilities = manifest.get("capabilities")
        if isinstance(capabilities, (list, tuple, set)):
            capability_items = [str(item).strip() for item in capabilities if item]
            if capability_items:
                summary_parts.append(" ".join(capability_items))
        elif capabilities:
            summary_parts.append(str(capabilities).strip())
        for key, value in manifest.items():
            if key == "capabilities":
                continue
            if value is None:
                continue
            if isinstance(value, dict):
                if value:
                    keys = ", ".join(sorted([str(item) for item in value.keys()]))
                    if keys:
                        summary_parts.append(f"{key}: {keys}")
                continue
            if isinstance(value, (list, tuple, set)):
                items = ", ".join([str(item) for item in value if item])
                if items:
                    summary_parts.append(f"{key}: {items}")
                continue
            summary_parts.append(f"{key}: {value}")
        if summary_parts:
            manifest_summary = "; ".join(summary_parts).strip()
    elif isinstance(manifest, str) and manifest.strip():
        manifest_summary = manifest.strip()

    parts = [
        skill.id,
        skill.name,
        skill.status,
        getattr(skill, "description", None),
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
        payload.update({key: value for key, value in optional_payload.items() if value})

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
