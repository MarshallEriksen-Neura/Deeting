from __future__ import annotations

import re
from pathlib import Path

from app.core.config import settings

_COMPONENT_SANITIZE_PATTERN = re.compile(r"[^A-Za-z0-9._-]")
_BUNDLE_READY_FILE = ".bundle_ready"


def get_plugin_ui_bundle_root() -> Path:
    workdir = Path(settings.REPO_INGESTION_WORKDIR).expanduser().resolve()
    return (workdir.parent / "plugins" / "ui-bundles").resolve()


def get_plugin_ui_bundle_dir(skill_id: str, revision: str) -> Path:
    skill_component = _normalize_component(skill_id, default="unknown_skill")
    revision_component = _normalize_component(revision, default="unknown_revision")
    return (get_plugin_ui_bundle_root() / skill_component / revision_component).resolve()


def get_bundle_ready_marker(bundle_dir: Path) -> Path:
    return bundle_dir / _BUNDLE_READY_FILE


def _normalize_component(value: str, *, default: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return default
    raw = raw.replace("\\", "_").replace("/", "_")
    cleaned = _COMPONENT_SANITIZE_PATTERN.sub("_", raw).strip("._-")
    return cleaned or default

