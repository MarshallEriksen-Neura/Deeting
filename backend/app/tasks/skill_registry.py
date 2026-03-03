from __future__ import annotations

import logging
import uuid
import json

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.providers.embedding import EmbeddingService
from app.services.notifications.task_notification import push_task_progress
from app.services.skill_registry.dry_run_service import SkillDryRunService
from app.services.skill_registry.skill_metrics_service import SkillMetricsService
from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor
from app.services.skill_registry.skill_self_heal_service import SkillSelfHealService
from app.storage.qdrant_kb_store import ensure_collection_vector_size, upsert_points
from app.tasks.async_runner import run_async

logger = logging.getLogger(__name__)

SKILL_COLLECTION_NAME = "skill_registry"


def _build_embedding_text(skill) -> str:
    max_manifest_length = 800
    manifest_summary = ""
    manifest = getattr(skill, "manifest_json", None)
    
    summary_parts: list[str] = []
    
    if isinstance(manifest, dict) and manifest:
        # 1. Basic Metadata
        for key in ["capabilities", "tags", "description", "summary"]:
            val = manifest.get(key)
            if val:
                summary_parts.append(f"{key}: {val}")
        
        # 2. CRITICAL: Include Tool Names and Descriptions
        tools = manifest.get("tools", [])
        if isinstance(tools, list):
            for t in tools:
                if isinstance(t, dict):
                    t_name = t.get("name", "")
                    t_desc = t.get("description", "")
                    summary_parts.append(f"Tool: {t_name} - {t_desc}")

        if summary_parts:
            manifest_summary = "; ".join(summary_parts).strip()

    if manifest_summary and len(manifest_summary) > 2000: # Increased budget
        manifest_summary = manifest_summary[:2000].rstrip()

    description = getattr(skill, "description", None) or ""
    
    parts = [
        skill.id,
        skill.name,
        description,
        manifest_summary,
    ]
    cleaned = [str(part).strip() for part in parts if part]
    return "\n".join(cleaned)


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

        vector_id = str(getattr(skill, "vector_id", "") or "").strip()
        vector_id_valid = False
        if vector_id:
            try:
                uuid.UUID(vector_id)
                vector_id_valid = True
            except ValueError:
                vector_id_valid = False
        if not vector_id_valid:
            vector_id = str(uuid.uuid4())
            await repo.update(skill, {"vector_id": vector_id})

        manifest = getattr(skill, "manifest_json", {}) or {}
        io_schema = manifest.get("io_schema", {})
        
        # If io_schema is a full tool definition (with 'parameters' key), 
        # use only the parameters part for the schema_json.
        schema_json = io_schema
        if isinstance(io_schema, dict) and "parameters" in io_schema:
            schema_json = io_schema["parameters"]

        description = getattr(skill, "description", None)
        if not description and isinstance(io_schema, dict):
            description = io_schema.get("description")

        payload = {
            "skill_id": skill.id,
            "name": skill.name,
            "status": skill.status,
            "description": description,
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
                    "id": vector_id,
                    "vector": vector,
                    "payload": payload,
                }
            ],
            wait=True,
        )
        return "upserted"


import yaml
from pathlib import Path
from app.core.config import settings

@celery_app.task(name="skill_registry.seed_builtins")
def seed_builtin_plugins_to_registry_task() -> dict[str, int]:
    try:
        return run_async(_run_seed_builtins())
    except Exception as exc:
        logger.exception("skill_registry_seed_builtins_failed: %s", exc)
        return {"created": 0, "updated": 0}

async def _run_seed_builtins() -> dict[str, int]:
    # Resolve project root relative to this file: backend/app/tasks/skill_registry.py
    project_root = Path(__file__).parent.parent.parent.parent
    official_skills_path = project_root / "packages" / "official-skills"
    
    from app.models.skill_registry import SkillRegistry
    from importlib import import_module

    stats = {"created": 0, "updated": 0}
    
    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        
        # 1. Seed from official-skills packages
        if official_skills_path.exists():
            for skill_dir in official_skills_path.iterdir():
                if not skill_dir.is_dir(): continue
                deeting_json = skill_dir / "deeting.json"
                if not deeting_json.exists(): continue
                
                try:
                    with open(deeting_json, "r") as f:
                        manifest = json.load(f)
                    
                    skill_id = manifest.get("id")
                    if not skill_id: continue
                    
                    # Read llm-tool.yaml if exists
                    llm_tool_path = skill_dir / "llm-tool.yaml"
                    tools = []
                    if llm_tool_path.exists():
                        with open(llm_tool_path, "r") as f:
                            tool_config = yaml.safe_load(f)
                            tools = tool_config.get("tools", [])
                    
                    manifest["tools"] = tools
                    
                    existing = await repo.get_by_id(skill_id)
                    if existing:
                        await repo.update(existing, {
                            "name": manifest.get("name"),
                            "description": manifest.get("description"),
                            "manifest_json": manifest,
                            "status": "active",
                            "runtime": "builtin"
                        })
                        stats["updated"] += 1
                    else:
                        new_skill = SkillRegistry(
                            id=skill_id,
                            name=manifest.get("name"),
                            description=manifest.get("description"),
                            type="SKILL",
                            runtime="builtin",
                            version=manifest.get("version", "1.0.0"),
                            manifest_json=manifest,
                            status="active"
                        )
                        session.add(new_skill)
                        stats["created"] += 1
                    
                    await session.flush()
                    await _run_sync_skill(skill_id)
                except Exception as e:
                    logger.error(f"Failed to seed official skill {skill_dir.name}: {e}")

        # 2. Legacy seeding from plugins.yaml (for remaining plugins)
        plugins_yaml_path = project_root / "backend" / "app" / "core" / "plugins.yaml"
        if plugins_yaml_path.exists():
            with open(plugins_yaml_path, "r") as f:
                config = yaml.safe_load(f)
            
            plugin_defs = config.get("plugins", [])
            from importlib import import_module

            for p_def in plugin_defs:
                p_id = p_def.get("id")
                # Skip if already migrated to official-skills
                if p_id in [
                    "core.tools.crawler", 
                    "system.code_interpreter", 
                    "system.planner",
                    "system.image_generation",
                    "system/vector_store",
                    "system.expert_network",
                    "system/database_manager",
                    "system/monitor",
                    "system/task_scheduler",
                    "core.registry.provider",
                    "core.tools.provider_probe",
                    "core.execution.skill_runner"
                ]:
                    continue
                    
                module_path = p_def.get("module")
                class_name = p_def.get("class_name")
                
                if not all([p_id, module_path, class_name]):
                    continue

                try:
                    # ... (rest of the legacy logic)
                    mod = import_module(module_path)
                    cls = getattr(mod, class_name)
                    plugin_inst = cls()
                    tools = plugin_inst.get_tools()
                    metadata = plugin_inst.metadata
                    
                    manifest = {
                        "capabilities": p_def.get("tools", []),
                        "description": p_def.get("description", metadata.description),
                        "version": metadata.version,
                        "author": metadata.author,
                        "tools": tools
                    }

                    existing = await repo.get_by_id(p_id)
                    if existing:
                        await repo.update(existing, {
                            "name": p_def.get("name", metadata.name),
                            "description": p_def.get("description", metadata.description),
                            "manifest_json": manifest,
                            "status": "active"
                        })
                        stats["updated"] += 1
                    else:
                        new_skill = SkillRegistry(
                            id=p_id,
                            name=p_def.get("name", metadata.name),
                            description=p_def.get("description", metadata.description),
                            type="SKILL",
                            runtime="builtin",
                            version=metadata.version,
                            manifest_json=manifest,
                            status="active"
                        )
                        session.add(new_skill)
                        stats["created"] += 1
                    
                    await session.flush()
                    await _run_sync_skill(p_id)
                except Exception as e:
                    logger.error(f"Failed to seed legacy plugin {p_id}: {e}")
        
        await session.commit()
    return stats

async def _run_sync_all_active_skills() -> int:
    if not qdrant_is_configured():
        return 0

    from app.models.skill_registry import SkillRegistry

    async with AsyncSessionLocal() as session:
        stmt = select(SkillRegistry).where(SkillRegistry.status == "active")
        result = await session.execute(stmt)
        skills = result.scalars().all()
        count = 0
        for skill in skills:
            try:
                res = await _run_sync_skill(skill.id)
                if res == "upserted":
                    count += 1
            except Exception as e:
                logger.warning(f"Failed to sync skill {skill.id}: {e}")
        return count


@celery_app.task(name="skill_registry.sync_all_active")
def sync_all_active_skills_task() -> int:
    try:
        return run_async(_run_sync_all_active_skills())
    except Exception as exc:
        logger.exception("skill_registry_sync_all_active_failed: %s", exc)
        return 0


@celery_app.task(name="skill_registry.sync_to_qdrant")
def sync_skill_to_qdrant(skill_id: str) -> str:
    try:
        return run_async(_run_sync_skill(skill_id))
    except Exception as exc:
        logger.exception("skill_registry_sync_to_qdrant_failed: %s", exc)
        return "failed"


async def _run_repo_ingestion(
    repo_url: str,
    revision: str = "main",
    skill_id: str | None = None,
    runtime_hint: str | None = None,
    source_subdir: str | None = None,
    user_id: str | None = None,
) -> dict:
    from app.services.skill_registry.manifest_generator import SkillManifestGenerator
    from app.services.skill_registry.parsers.deeting_plugin import DeetingPluginParser
    from app.services.skill_registry.parsers.generic_parser import GenericRepoParser
    from app.services.skill_registry.parsers.node_parser import NodeRepoParser
    from app.services.skill_registry.parsers.python_parser import PythonRepoParser
    from app.services.skill_registry.repo_ingestion_service import RepoIngestionService

    job_id = str(uuid.uuid4())[:8]
    await push_task_progress(
        user_id, job_id, "initialization", "正在初始化技能解析引擎...", percentage=10
    )

    async with AsyncSessionLocal() as session:
        repo = SkillRegistryRepository(session)
        service = RepoIngestionService(
            repo=repo,
            manifest_generator=SkillManifestGenerator(),
            parsers=[
                DeetingPluginParser(),
                PythonRepoParser(),
                NodeRepoParser(),
                GenericRepoParser(),
            ],
        )

        await push_task_progress(
            user_id, job_id, "ingesting", f"正在从 Git 仓库 {repo_url} 获取源码...", percentage=40
        )
        result = await service.ingest_repo(
            repo_url=repo_url,
            revision=revision,
            skill_id=skill_id,
            runtime_hint=runtime_hint,
            source_subdir=source_subdir,
            user_id=user_id,
        )

        await push_task_progress(
            user_id, job_id, "completed", f"技能 '{result.get('skill_id')}' 已成功接入并注册！", status="completed", percentage=100
        )
        return result


@celery_app.task(name="skill_registry.ingest_repo")
def ingest_skill_repo(
    repo_url: str,
    revision: str = "main",
    skill_id: str | None = None,
    runtime_hint: str | None = None,
    source_subdir: str | None = None,
    user_id: str | None = None,
) -> dict | str:
    try:
        result = run_async(
            _run_repo_ingestion(
                repo_url=repo_url,
                revision=revision,
                skill_id=skill_id,
                runtime_hint=runtime_hint,
                source_subdir=source_subdir,
                user_id=user_id,
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
        return run_async(_run_skill_dry_run(skill_id))
    except Exception as exc:
        logger.exception("skill_registry_dry_run_failed: %s", exc)
        return "failed"


def _trigger_dry_run(skill_id: str) -> None:
    if hasattr(dry_run_skill, "apply_async"):
        dry_run_skill.apply_async(args=[skill_id], queue="skill_registry")
    else:
        dry_run_skill(skill_id)
