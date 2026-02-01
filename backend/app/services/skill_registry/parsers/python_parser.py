from __future__ import annotations

from pathlib import Path

from app.services.skill_registry.parsers.base import EvidencePack, RepoContext, RepoParserPlugin


class PythonRepoParser(RepoParserPlugin):
    def can_handle(self, repo_context: RepoContext) -> bool:
        markers = {"pyproject.toml", "requirements.txt", "setup.py"}
        return any(path in markers for path in repo_context.file_index)

    def collect_evidence(self, repo_context: RepoContext) -> EvidencePack:
        readme = _read_readme(repo_context.root_path)
        dependencies = _read_requirements(repo_context.root_path)
        return EvidencePack(
            files=repo_context.file_index,
            readme=readme,
            dependencies=dependencies,
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


def _read_requirements(root_path: Path) -> list[str]:
    path = root_path / "requirements.txt"
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]
