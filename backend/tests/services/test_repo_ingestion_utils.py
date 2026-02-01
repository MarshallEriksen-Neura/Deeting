from pathlib import Path

import pytest

from app.services.skill_registry import repo_ingestion_utils
from app.services.skill_registry.repo_ingestion_utils import build_file_index


def test_build_file_index_excludes_git(tmp_path: Path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "nested").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('ok')")
    (tmp_path / "src" / "nested" / "main.py").write_text("print('ok')")
    (tmp_path / ".git" / "config").write_text("x")
    files = build_file_index(tmp_path)
    assert "src/main.py" in files
    assert "src/nested/main.py" in files
    assert all("\\" not in path for path in files)
    assert not any(path.startswith(".git") for path in files)


def test_build_file_index_excludes_git_file(tmp_path: Path):
    (tmp_path / ".git").write_text("gitdir: /tmp/worktree")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('ok')")

    files = build_file_index(tmp_path)

    assert "src/main.py" in files
    assert ".git" not in files


def test_build_file_index_prunes_git_directory(monkeypatch, tmp_path: Path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('ok')")

    def fake_walk(root, *args, **kwargs):
        dirnames = [".git", "src"]
        filenames: list[str] = []
        yield str(tmp_path), dirnames, filenames
        assert ".git" not in dirnames
        yield str(tmp_path / "src"), [], ["main.py"]

    monkeypatch.setattr(repo_ingestion_utils.os, "walk", fake_walk)

    files = build_file_index(tmp_path)
    assert files == ["src/main.py"]


def test_build_file_index_raises_for_missing_root(tmp_path: Path):
    missing = tmp_path / "missing"
    with pytest.raises(FileNotFoundError, match="does not exist"):
        build_file_index(missing)


def test_build_file_index_raises_for_file_root(tmp_path: Path):
    root_file = tmp_path / "root.txt"
    root_file.write_text("data")
    with pytest.raises(NotADirectoryError, match="not a directory"):
        build_file_index(root_file)
