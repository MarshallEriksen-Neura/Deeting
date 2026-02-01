from pathlib import Path

from app.services.skill_registry.parsers.node_parser import NodeRepoParser
from app.services.skill_registry.parsers.python_parser import PythonRepoParser
from app.services.skill_registry.parsers.base import RepoContext
from app.services.skill_registry.repo_ingestion_service import RepoIngestionService


def test_select_parser_python(tmp_path: Path):
    repo_context = RepoContext(
        repo_url="https://example.com/repo.git",
        revision="main",
        root_path=tmp_path,
        file_index=["pyproject.toml"],
    )

    service = RepoIngestionService(parsers=[PythonRepoParser(), NodeRepoParser()])
    parser = service.select_parser(repo_context)

    assert parser.__class__.__name__ == "PythonRepoParser"
