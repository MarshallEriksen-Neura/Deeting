from __future__ import annotations

import json
from pathlib import Path

from app.services.skill_registry.parsers.base import (
    EvidencePack,
    RepoContext,
    RepoParserPlugin,
)


class NodeRepoParser(RepoParserPlugin):
    def can_handle(self, repo_context: RepoContext) -> bool:
        return "package.json" in repo_context.file_index

    def collect_evidence(self, repo_context: RepoContext) -> EvidencePack:
        readme = _read_readme(repo_context.root_path)
        dependencies = _read_dependencies(repo_context.root_path)
        entrypoints = _read_entrypoints(repo_context.root_path)
        return EvidencePack(
            files=repo_context.file_index,
            readme=readme,
            dependencies=dependencies,
            entrypoints=entrypoints,
        )

    def extract_manifest(self, evidence: EvidencePack) -> dict:
        return {
            "description": (evidence.readme or "").strip()[:500],
            "dependencies": evidence.dependencies,
        }


def _read_readme(root_path: Path) -> str | None:
    for candidate in ("README.md", "README.MD", "readme.md"):
        path = root_path / candidate
        if path.exists():
            return path.read_text(encoding="utf-8")
    return None


def _read_dependencies(root_path: Path) -> list[str]:
    path = root_path / "package.json"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    deps = payload.get("dependencies") or {}
    dev_deps = payload.get("devDependencies") or {}
    return sorted({*deps.keys(), *dev_deps.keys()})


def _read_entrypoints(root_path: Path) -> list[str]:
    path = root_path / "package.json"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    bin_field = payload.get("bin")
    if isinstance(bin_field, str):
        return [bin_field]
    if isinstance(bin_field, dict):
        entrypoints: list[str] = []
        for value in bin_field.values():
            if isinstance(value, str) and value:
                entrypoints.append(value)
        return entrypoints
    return []
