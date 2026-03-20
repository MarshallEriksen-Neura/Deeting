from __future__ import annotations

import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path


PROTOC_ASSET_SUFFIX = {
    "aarch64-apple-darwin": "osx-aarch_64",
    "x86_64-apple-darwin": "osx-x86_64",
    "x86_64-unknown-linux-gnu": "linux-x86_64",
    "x86_64-pc-windows-msvc": "win64",
}


def append_env_file(file_path: str | None, line: str) -> None:
    if not file_path:
        return
    with open(file_path, "a", encoding="utf-8") as handle:
        handle.write(f"{line}\n")


def resolve_target() -> str:
    matrix_target = os.environ.get("MATRIX_TARGET", "").strip()
    if not matrix_target:
        raise SystemExit("MATRIX_TARGET is required to install protoc in CI")
    if matrix_target not in PROTOC_ASSET_SUFFIX:
        raise SystemExit(f"Unsupported MATRIX_TARGET for protoc install: {matrix_target}")
    return matrix_target


def main() -> int:
    version = os.environ.get("PROTOC_VERSION", "33.4").strip()
    target = resolve_target()
    asset_suffix = PROTOC_ASSET_SUFFIX[target]

    runner_temp = Path(os.environ.get("RUNNER_TEMP", ".")).resolve()
    install_root = runner_temp / f"protoc-{version}-{asset_suffix}"
    archive_path = runner_temp / f"protoc-{version}-{asset_suffix}.zip"

    if install_root.exists():
        shutil.rmtree(install_root)
    if archive_path.exists():
        archive_path.unlink()

    url = (
        f"https://github.com/protocolbuffers/protobuf/releases/download/"
        f"v{version}/protoc-{version}-{asset_suffix}.zip"
    )

    print(f"[install_protoc] Downloading {url}")
    install_root.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, archive_path)

    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(install_root)

    protoc_name = "protoc.exe" if os.name == "nt" else "protoc"
    protoc_path = install_root / "bin" / protoc_name
    if not protoc_path.exists():
        raise SystemExit(f"Expected protoc binary was not found at {protoc_path}")

    append_env_file(os.environ.get("GITHUB_PATH"), str(protoc_path.parent))
    append_env_file(os.environ.get("GITHUB_ENV"), f"PROTOC={protoc_path}")

    print(f"[install_protoc] Installed protoc at {protoc_path}")
    subprocess.run([str(protoc_path), "--version"], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
