from pathlib import Path

from app.services.skill_registry.repo_ingestion_utils import build_file_index


def test_build_file_index_excludes_git(tmp_path: Path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('ok')")
    (tmp_path / ".git" / "config").write_text("x")
    files = build_file_index(tmp_path)
    assert "src/main.py" in files
    assert not any(path.startswith(".git") for path in files)
