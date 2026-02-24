from __future__ import annotations

from pathlib import Path

from app.services.skill_registry.parsers.base import (
    EvidencePack,
    RepoContext,
    RepoParserPlugin,
)


class GenericRepoParser(RepoParserPlugin):
    """Fallback parser for repositories without known framework markers."""

    def can_handle(self, _repo_context: RepoContext) -> bool:
        return True

    def collect_evidence(self, repo_context: RepoContext) -> EvidencePack:
        readme = _read_readme(repo_context.root_path)
        dependencies = _collect_dependencies(repo_context.root_path)
        entrypoints = _collect_entrypoints(repo_context.root_path)
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
    for candidate in ("SKILL.md", "README.md", "README.MD", "readme.md"):
        path = root_path / candidate
        if path.exists():
            return path.read_text(encoding="utf-8")
    return None


def _collect_dependencies(root_path: Path) -> list[str]:
    requirements_path = root_path / "requirements.txt"
    if requirements_path.exists():
        lines = requirements_path.read_text(encoding="utf-8").splitlines()
        return [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    return []


def _collect_entrypoints(root_path: Path) -> list[str]:
    candidates = (
        "main.py",
        "__main__.py",
        "index.js",
        "src/main.py",
        "src/index.ts",
        "src/index.js",
    )
    entrypoints: list[str] = []
    for candidate in candidates:
        path = root_path / candidate
        if path.exists():
            entrypoints.append(candidate)
    return entrypoints
