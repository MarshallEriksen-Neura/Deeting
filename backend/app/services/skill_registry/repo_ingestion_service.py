from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
import time
import uuid
from collections.abc import Iterable
from pathlib import Path

from app.core.config import settings
from app.repositories.skill_artifact_repository import SkillArtifactRepository
from app.repositories.skill_capability_repository import SkillCapabilityRepository
from app.repositories.skill_dependency_repository import SkillDependencyRepository
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.plugin_ui_bundle_storage import (
    get_bundle_ready_marker,
    get_plugin_ui_bundle_dir,
)
from app.services.skill_registry.manifest_generator import SkillManifestGenerator
from app.services.skill_registry.parsers.base import RepoContext, RepoParserPlugin
from app.services.skill_registry.repo_ingestion_utils import build_file_index

logger = logging.getLogger(__name__)


class RepoIngestionService:
    def __init__(
        self,
        parsers: Iterable[RepoParserPlugin],
        repo: SkillRegistryRepository | None = None,
        manifest_generator: SkillManifestGenerator | None = None,
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
        user_id: str | None = None,
    ) -> dict:
        if self.repo is None or self.manifest_generator is None:
            raise ValueError("repo and manifest_generator are required for ingestion")
        workdir = _ensure_workdir()
        temp_root = None
        try:
            repo_root, temp_root = clone_repo(repo_url, revision, workdir)

            effective_root = repo_root
            if source_subdir:
                effective_root = repo_root / source_subdir.strip("/")
                if not effective_root.exists():
                    raise ValueError(
                        f"Source subdir '{source_subdir}' not found in repo"
                    )

            file_index = build_file_index(effective_root)
            repo_context = RepoContext(
                repo_url=repo_url,
                revision=revision,
                root_path=effective_root,
                file_index=file_index,
            )
            parser = self.select_parser(repo_context)
            evidence = parser.collect_evidence(repo_context)
            runtime = runtime_hint or "python_library"

            if parser.is_authoritative:
                manifest = parser.extract_manifest(evidence)
                logger.info(f"Using authoritative manifest from parser: {parser.__class__.__name__}")
            else:
                manifest = await self.manifest_generator.generate(
                    evidence,
                    runtime=runtime,
                    user_id=user_id,
                )
                # Merge parser evidence if needed
                parser_manifest = parser.extract_manifest(evidence)
                if parser_manifest:
                    for k, v in parser_manifest.items():
                        if v and not manifest.get(k):
                            manifest[k] = v

            # Improve resolved_skill_id generation logic
            repo_name_from_url = ""
            if repo_url:
                repo_name_from_url = repo_url.rstrip("/").split("/")[-1].replace(".git", "")

            resolved_skill_id = (
                skill_id
                or str(manifest.get("id") or "").strip()
                or str(manifest.get("name") or "").strip()
                or repo_name_from_url
                or "ingested_skill"
            )
            if not resolved_skill_id:
                raise ValueError("skill_id is required for ingestion")
            ui_bundle_meta = _extract_ui_bundle(
                repo_root=effective_root,
                skill_id=resolved_skill_id,
                revision=revision,
            )
            manifest = _enrich_manifest_with_ui_bundle(manifest, ui_bundle_meta)
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
    cmd = [
        "git",
        "clone",
        "--depth",
        "1",
        "--branch",
        revision,
        repo_url,
        str(repo_root),
    ]
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


def _extract_ui_bundle(
    *,
    repo_root: Path,
    skill_id: str,
    revision: str,
) -> dict | None:
    deeting_manifest = _read_deeting_manifest(repo_root)
    if not isinstance(deeting_manifest, dict):
        return None
    entry = deeting_manifest.get("entry")
    if not isinstance(entry, dict):
        return None
    renderer_raw = entry.get("renderer")
    renderer_entry = str(renderer_raw or "").strip().lstrip("/")
    if not renderer_entry:
        return None

    renderer_path = _safe_resolve_in_root(repo_root, renderer_entry)
    if renderer_path is None or not renderer_path.exists():
        return None

    if renderer_path.is_dir():
        source_dir = renderer_path
        renderer_asset_path = "index.html"
    else:
        source_dir = renderer_path.parent
        renderer_asset_path = renderer_path.name

    bundle_dir = get_plugin_ui_bundle_dir(skill_id=skill_id, revision=revision)
    ready_marker = get_bundle_ready_marker(bundle_dir)
    if ready_marker.exists():
        return {
            "renderer_entry": renderer_entry,
            "renderer_asset_path": renderer_asset_path,
            "bundle_ready": True,
            "copied": False,
        }

    if bundle_dir.exists():
        shutil.rmtree(bundle_dir, ignore_errors=True)
    bundle_dir.parent.mkdir(parents=True, exist_ok=True)
    temp_bundle_dir = bundle_dir.parent / f".{bundle_dir.name}.tmp-{uuid.uuid4().hex[:8]}"
    shutil.copytree(source_dir, temp_bundle_dir, symlinks=True)
    metadata = {
        "renderer_entry": renderer_entry,
        "renderer_asset_path": renderer_asset_path,
        "copied_at": int(time.time()),
        "skill_id": str(skill_id),
        "revision": str(revision),
    }
    get_bundle_ready_marker(temp_bundle_dir).write_text(
        json.dumps(metadata, ensure_ascii=False),
        encoding="utf-8",
    )
    temp_bundle_dir.replace(bundle_dir)
    return {
        "renderer_entry": renderer_entry,
        "renderer_asset_path": renderer_asset_path,
        "bundle_ready": True,
        "copied": True,
    }


def _read_deeting_manifest(repo_root: Path) -> dict | None:
    path = repo_root / "deeting.json"
    if not path.exists() or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if isinstance(payload, dict):
        return payload
    return None


def _safe_resolve_in_root(root: Path, relative_path: str) -> Path | None:
    root_resolved = root.resolve()
    target = (root_resolved / relative_path).resolve()
    if target == root_resolved or target.is_relative_to(root_resolved):
        return target
    return None


def _enrich_manifest_with_ui_bundle(manifest: dict, ui_bundle_meta: dict | None) -> dict:
    payload = dict(manifest or {})
    if not ui_bundle_meta:
        return payload
    payload["ui_bundle"] = {
        "renderer_entry": str(ui_bundle_meta.get("renderer_entry") or ""),
        "renderer_asset_path": str(ui_bundle_meta.get("renderer_asset_path") or ""),
        "bundle_ready": bool(ui_bundle_meta.get("bundle_ready")),
    }
    return payload


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
