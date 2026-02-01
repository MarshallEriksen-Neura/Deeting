from __future__ import annotations

import os
from pathlib import Path


def build_file_index(root: Path) -> list[str]:
    if not root.exists():
        raise FileNotFoundError(f"root path does not exist: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"root path is not a directory: {root}")

    files: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [dirname for dirname in dirnames if dirname != ".git"]
        for filename in filenames:
            path = Path(dirpath) / filename
            if not path.is_file():
                continue
            relative_path = path.relative_to(root)
            if ".git" in relative_path.parts:
                continue
            files.append(relative_path.as_posix())
    return sorted(files)
