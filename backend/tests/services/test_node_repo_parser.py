from pathlib import Path

from app.services.skill_registry.parsers.base import RepoContext
from app.services.skill_registry.parsers.node_parser import NodeRepoParser


def test_node_parser_reads_entrypoints(tmp_path: Path):
    (tmp_path / "package.json").write_text(
        '{"bin": {"docx": "bin/docx.js"}}',
        encoding="utf-8",
    )
    ctx = RepoContext(
        repo_url="x",
        revision="main",
        root_path=tmp_path,
        file_index=["package.json"],
    )
    evidence = NodeRepoParser().collect_evidence(ctx)
    assert "bin/docx.js" in evidence.entrypoints
