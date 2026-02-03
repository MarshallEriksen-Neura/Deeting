from __future__ import annotations

from typing import Iterable

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.config import settings
from app.repositories.skill_artifact_repository import SkillArtifactRepository
from app.repositories.skill_capability_repository import SkillCapabilityRepository
from app.repositories.skill_dependency_repository import SkillDependencyRepository
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.skill_registry.manifest_generator import SkillManifestGenerator
from app.services.skill_registry.repo_ingestion_utils import build_file_index
from app.services.skill_registry.parsers.base import RepoContext, RepoParserPlugin


class RepoIngestionService:
    def __init__(
        self,
        repo: SkillRegistryRepository,
        manifest_generator: SkillManifestGenerator,
        parsers: Iterable[RepoParserPlugin],
        capability_repo: SkillCapabilityRepository | None = None,
        dependency_repo: SkillDependencyRepository | None = None,
        artifact_repo: SkillArtifactRepository | None = None,
    ):
        self.repo = repo
        self.manifest_generator = manifest_generator
        self.parsers = list(parsers)
        self.capability_repo = capability_repo
        self.dependency_repo = dependency_repo
        self.artifact_repo = artifact_repo

    def select_parser(self, repo_context: RepoContext) -> RepoParserPlugin:
        for parser in self.parsers:
            if parser.can_handle(repo_context):
                return parser
        raise ValueError("No parser available for repo")

    def build_evidence(self, repo_context: RepoContext):
        parser = self.select_parser(repo_context)
        return parser.collect_evidence(repo_context)

    def extract_manifest(self, repo_context: RepoContext) -> dict:
        parser = self.select_parser(repo_context)
        evidence = parser.collect_evidence(repo_context)
        return parser.extract_manifest(evidence)

    async def ingest_repo(
        self,
        repo_url: str,
        revision: str = "main",
        skill_id: str | None = None,
        runtime_hint: str | None = None,
        source_subdir: str | None = None,
    ) -> dict:
        workdir = _ensure_workdir()
        temp_root = None
        try:
            repo_root, temp_root = clone_repo(repo_url, revision, workdir)
            file_index = build_file_index(repo_root)
            repo_context = RepoContext(
                repo_url=repo_url,
                revision=revision,
                root_path=repo_root,
                file_index=file_index,
            )
            parser = self.select_parser(repo_context)
            evidence = parser.collect_evidence(repo_context)
            runtime = runtime_hint or "python_library"
            manifest = await self.manifest_generator.generate(evidence, runtime=runtime)
            resolved_skill_id = (
                skill_id
                or str(manifest.get("id") or "").strip()
                or str(manifest.get("name") or "").strip()
            )
            if not resolved_skill_id:
                raise ValueError("skill_id is required for ingestion")
            payload = _build_skill_payload(
                resolved_skill_id,
                manifest,
                repo_url,
                revision,
                runtime,
                source_subdir,
            )
            existing = await self.repo.get_by_id(resolved_skill_id)
            if existing:
                await self.repo.update(existing, payload)
                status = "updated"
            else:
                await self.repo.create(payload)
                status = "created"
            await _persist_relations(
                resolved_skill_id,
                manifest,
                self.capability_repo,
                self.dependency_repo,
                self.artifact_repo,
            )
            _trigger_qdrant_sync(resolved_skill_id)
            return {"skill_id": resolved_skill_id, "status": status}
        finally:
            if temp_root:
                shutil.rmtree(temp_root, ignore_errors=True)


def _ensure_workdir() -> Path:
    workdir = Path(settings.REPO_INGESTION_WORKDIR).expanduser()
    workdir.mkdir(parents=True, exist_ok=True)
    return workdir


def clone_repo(repo_url: str, revision: str, workdir: Path) -> tuple[Path, Path]:
    temp_root = Path(tempfile.mkdtemp(dir=workdir))
    repo_root = temp_root / "repo"
    cmd = ["git", "clone", "--depth", "1", "--branch", revision, repo_url, str(repo_root)]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return repo_root, temp_root


def _build_skill_payload(
    skill_id: str,
    manifest: dict,
    repo_url: str,
    revision: str,
    runtime: str,
    source_subdir: str | None,
) -> dict:
    env_requirements = manifest.get("env_requirements")
    if not isinstance(env_requirements, dict):
        env_requirements = {}
    complexity_score = _extract_complexity_score(manifest)
    return {
        "id": skill_id,
        "name": manifest.get("name") or skill_id,
        "description": manifest.get("description"),
        "runtime": runtime,
        "version": manifest.get("version"),
        "source_repo": repo_url,
        "source_subdir": source_subdir,
        "source_revision": revision,
        "risk_level": manifest.get("risk_level"),
        "complexity_score": complexity_score,
        "manifest_json": manifest,
        "env_requirements": env_requirements,
    }


def _extract_complexity_score(manifest: dict) -> float | None:
    usage_spec = manifest.get("usage_spec")
    if not isinstance(usage_spec, dict):
        return None
    example_code = usage_spec.get("example_code")
    if not isinstance(example_code, str):
        return None
    return float(len(example_code))


async def _persist_relations(
    skill_id: str,
    manifest: dict,
    capability_repo: SkillCapabilityRepository | None,
    dependency_repo: SkillDependencyRepository | None,
    artifact_repo: SkillArtifactRepository | None,
) -> None:
    if capability_repo is not None:
        capabilities = _normalize_string_list(manifest.get("capabilities"))
        await capability_repo.replace_all(skill_id, capabilities)
    if dependency_repo is not None:
        dependencies = _normalize_string_list(manifest.get("dependencies"))
        await dependency_repo.replace_all(skill_id, dependencies)
    if artifact_repo is not None:
        artifacts = _normalize_string_list(manifest.get("artifacts"))
        await artifact_repo.replace_all(skill_id, artifacts)


def _normalize_string_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if item is not None]
    return [str(value)]


def _trigger_qdrant_sync(skill_id: str) -> None:
    from app.tasks.skill_registry import sync_skill_to_qdrant

    if hasattr(sync_skill_to_qdrant, "delay"):
        sync_skill_to_qdrant.delay(skill_id)
    else:
        sync_skill_to_qdrant(skill_id)
