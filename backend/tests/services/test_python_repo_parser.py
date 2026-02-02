from pathlib import Path

from app.services.skill_registry.parsers.base import RepoContext
from app.services.skill_registry.parsers.python_parser import PythonRepoParser


def test_python_parser_reads_pyproject_dependencies(tmp_path: Path):
    (tmp_path / "pyproject.toml").write_text(
        """
    [project]
    dependencies = ["requests>=2.0", "pydantic"]
    """,
        encoding="utf-8",
    )
    ctx = RepoContext(
        repo_url="x",
        revision="main",
        root_path=tmp_path,
        file_index=["pyproject.toml"],
    )
    evidence = PythonRepoParser().collect_evidence(ctx)
    assert "requests" in " ".join(evidence.dependencies)
