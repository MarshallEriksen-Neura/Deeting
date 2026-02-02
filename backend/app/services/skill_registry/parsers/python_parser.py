from __future__ import annotations

from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python <3.11 fallback
    tomllib = None

from app.services.skill_registry.parsers.base import EvidencePack, RepoContext, RepoParserPlugin


class PythonRepoParser(RepoParserPlugin):
    def can_handle(self, repo_context: RepoContext) -> bool:
        markers = {"pyproject.toml", "requirements.txt", "setup.py"}
        return any(path in markers for path in repo_context.file_index)

    def collect_evidence(self, repo_context: RepoContext) -> EvidencePack:
        readme = _read_readme(repo_context.root_path)
        dependencies = _merge_dependencies(repo_context.root_path)
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


def _read_pyproject_dependencies(root_path: Path) -> list[str]:
    if tomllib is None:
        return []
    path = root_path / "pyproject.toml"
    if not path.exists():
        return []
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    project = data.get("project") or {}
    dependencies = project.get("dependencies") or []
    if not isinstance(dependencies, list):
        return []
    cleaned: list[str] = []
    for dep in dependencies:
        if not isinstance(dep, str):
            continue
        name = dep.split(";", 1)[0].strip()
        for separator in ("<=", ">=", "==", "!=", "~=", "<", ">"):
            if separator in name:
                name = name.split(separator, 1)[0].strip()
                break
        if name:
            cleaned.append(name)
    return cleaned


def _merge_dependencies(root_path: Path) -> list[str]:
    items = [*_read_requirements(root_path), *_read_pyproject_dependencies(root_path)]
    seen: set[str] = set()
    merged: list[str] = []
    for item in items:
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)
    return merged


def _collect_entrypoints(root_path: Path) -> list[str]:
    candidates = [
        root_path / "__main__.py",
        root_path / "main.py",
        root_path / "cli.py",
        root_path / "bin" / "main.py",
        root_path / "src" / "__main__.py",
        root_path / "src" / "main.py",
    ]
    entrypoints: list[str] = []
    for path in candidates:
        if path.exists():
            entrypoints.append(path.relative_to(root_path).as_posix())
    return entrypoints
