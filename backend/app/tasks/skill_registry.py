from __future__ import annotations

import asyncio
import logging

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.providers.embedding import EmbeddingService
from app.services.skill_registry.dry_run_service import SkillDryRunService
from app.services.skill_registry.manifest_generator import SkillManifestGenerator
from app.services.skill_registry.parsers.node_parser import NodeRepoParser
from app.services.skill_registry.parsers.python_parser import PythonRepoParser
from app.services.skill_registry.repo_ingestion_service import RepoIngestionService
from app.services.skill_registry.skill_metrics_service import SkillMetricsService
from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor
from app.services.skill_registry.skill_self_heal_service import SkillSelfHealService
from app.storage.qdrant_kb_store import ensure_collection_vector_size, upsert_points

logger = logging.getLogger(__name__)

SKILL_COLLECTION_NAME = "skill_registry"


def _build_embedding_text(skill) -> str:
    max_manifest_length = 800
    manifest_summary = ""
    manifest = getattr(skill, "manifest_json", None)
    if isinstance(manifest, dict) and manifest:
        allowed_keys = (
            "capabilities",
            "keywords",
            "tags",
            "summary",
            "title",
            "description",
        )
        summary_parts: list[str] = []
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
                summary_parts.append(" ".join(capability_items))
        elif capabilities is not None:
            text = str(capabilities).strip()
            if text:
                summary_parts.append(text)

        for key in allowed_keys:
            if key == "capabilities":
                continue
            value = manifest.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if not text:
                continue
            if len(text) > max_manifest_length:
                text = text[:max_manifest_length].rstrip()
            summary_parts.append(f"{key}: {text}")

        if summary_parts:
            manifest_summary = "; ".join(summary_parts).strip()
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

        manifest = getattr(skill, "manifest_json", {}) or {}
        schema_json = manifest.get("io_schema", {})

        payload = {
            "skill_id": skill.id,
            "name": skill.name,
            "status": skill.status,
            "schema_json": schema_json,
            "embedding_model": embedding_service.model,
        }
        optional_payload = {
            "runtime": getattr(skill, "runtime", None),
            "risk_level": getattr(skill, "risk_level", None),
            "source_repo": getattr(skill, "source_repo", None),
        }
        payload.update(
            {key: value for key, value in optional_payload.items() if value is not None}
        )

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


async def _run_repo_ingestion(
    repo_url: str,
    revision: str = "main",
    skill_id: str | None = None,
    runtime_hint: str | None = None,
) -> dict:
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        service = RepoIngestionService(
            repo=repo,
            manifest_generator=SkillManifestGenerator(),
            parsers=[PythonRepoParser(), NodeRepoParser()],
        )
        return await service.ingest_repo(
            repo_url=repo_url,
            revision=revision,
            skill_id=skill_id,
            runtime_hint=runtime_hint,
        )


@celery_app.task(name="skill_registry.ingest_repo")
def ingest_skill_repo(
    repo_url: str,
    revision: str = "main",
    skill_id: str | None = None,
    runtime_hint: str | None = None,
) -> dict | str:
    try:
        result = asyncio.run(
            _run_repo_ingestion(
                repo_url=repo_url,
                revision=revision,
                skill_id=skill_id,
                runtime_hint=runtime_hint,
            )
        )
        if isinstance(result, dict):
            resolved_skill_id = result.get("skill_id")
            if resolved_skill_id:
                _trigger_dry_run(str(resolved_skill_id))
        return result
    except Exception as exc:
        logger.exception("skill_registry_ingest_repo_failed: %s", exc)
        return "failed"


async def _run_skill_dry_run(skill_id: str) -> dict:
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        executor = SkillRuntimeExecutor(repo)
        metrics = SkillMetricsService(repo, failure_threshold=2)
        dry_run_service = SkillDryRunService(
            repo,
            executor,
            metrics,
            failure_threshold=2,
            self_heal_service=None,
            self_heal_max_attempts=2,
        )
        self_heal_service = SkillSelfHealService(repo, dry_run_service=dry_run_service)
        dry_run_service.self_heal_service = self_heal_service
        return await dry_run_service.run(skill_id)


@celery_app.task(queue="skill_registry", name="skill_registry.dry_run_skill")
def dry_run_skill(skill_id: str) -> dict | str:
    try:
        return asyncio.run(_run_skill_dry_run(skill_id))
    except Exception as exc:
        logger.exception("skill_registry_dry_run_failed: %s", exc)
        return "failed"


def _trigger_dry_run(skill_id: str) -> None:
    if hasattr(dry_run_skill, "apply_async"):
        dry_run_skill.apply_async(args=[skill_id], queue="skill_registry")
    else:
        dry_run_skill(skill_id)
