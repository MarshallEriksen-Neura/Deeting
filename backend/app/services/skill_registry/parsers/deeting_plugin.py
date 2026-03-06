from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import jsonschema
import yaml

from app.services.skill_registry.parsers.base import (
    EvidencePack,
    RepoContext,
    RepoParserPlugin,
)

logger = logging.getLogger(__name__)

_SCHEMA_PATH = Path(__file__).resolve().parents[5] / "packages" / "deeting-manifest-schema.json"
_cached_schema: dict | None = None


def _load_manifest_schema() -> dict | None:
    global _cached_schema
    if _cached_schema is not None:
        return _cached_schema
    if _SCHEMA_PATH.exists():
        try:
            _cached_schema = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
            return _cached_schema
        except Exception:
            logger.warning("failed to load deeting manifest schema from %s", _SCHEMA_PATH)
    return None


def validate_deeting_manifest(manifest: dict) -> list[str]:
    """Validate a deeting.json manifest against the schema.
    Returns a list of error messages (empty if valid)."""
    schema = _load_manifest_schema()
    if schema is None:
        return []
    errors: list[str] = []
    validator = jsonschema.Draft7Validator(schema)
    for error in validator.iter_errors(manifest):
        path = ".".join(str(p) for p in error.absolute_path) if error.absolute_path else "(root)"
        errors.append(f"{path}: {error.message}")
    return errors


class DeetingPluginParser(RepoParserPlugin):
    """
    Parser for repositories following the Deeting Plugin Standard.
    Looks for deeting.json and llm-tool.yaml.
    """

    @property
    def is_authoritative(self) -> bool:
        return True

    def can_handle(self, repo_context: RepoContext) -> bool:
        # If deeting.json exists, we prioritize this parser
        return "deeting.json" in repo_context.file_index

    def collect_evidence(self, repo_context: RepoContext) -> EvidencePack:
        root = repo_context.root_path
        
        # 1. Read and validate deeting.json
        manifest_data = {}
        manifest_path = root / "deeting.json"
        if manifest_path.exists():
            try:
                manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass

        validation_errors = validate_deeting_manifest(manifest_data) if manifest_data else []
        if validation_errors:
            skill_id = manifest_data.get("id", "unknown")
            logger.warning(
                "deeting.json schema validation errors for %s: %s",
                skill_id,
                "; ".join(validation_errors),
            )

        # 2. Read llm-tool.yaml (or specified path in deeting.json)
        tool_spec_path = "llm-tool.yaml"
        capabilities_meta = manifest_data.get("capabilities", {})
        if isinstance(capabilities_meta, dict):
            tool_spec_path = capabilities_meta.get("llm_tools") or tool_spec_path
        
        tool_spec_data = {}
        tool_path = root / tool_spec_path
        if tool_path.exists():
            try:
                tool_spec_data = yaml.safe_load(tool_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        # 3. Read README
        readme = ""
        for candidate in ("README.md", "README.MD", "readme.md"):
            path = root / candidate
            if path.exists():
                readme = path.read_text(encoding="utf-8")
                break

        # Combine into EvidencePack
        # We store the raw structured data in metadata for extract_manifest
        evidence = EvidencePack(
            files=repo_context.file_index,
            readme=readme,
            dependencies=self._extract_dependencies(manifest_data, root),
            entrypoints=self._extract_entrypoints(manifest_data),
        )
        evidence.metadata = {
            "deeting_json": manifest_data,
            "llm_tool_yaml": tool_spec_data,
            "validation_errors": validation_errors,
        }
        return evidence

    def extract_manifest(self, evidence: EvidencePack) -> dict[str, Any]:
        """
        Produce the final manifest. Since deeting.json is the source of truth,
        we use it directly if available.
        """
        raw_meta = getattr(evidence, "metadata", {}) or {}
        deeting_json = raw_meta.get("deeting_json") or {}
        tool_spec = raw_meta.get("llm_tool_yaml") or {}

        # Deeting Standard Manifest
        description = deeting_json.get("description")
        if not description and tool_spec.get("description"):
            description = tool_spec.get("description")
        if not description and evidence.readme:
            description = evidence.readme[:300]

        manifest = {
            "id": deeting_json.get("id"),
            "name": deeting_json.get("name"),
            "version": deeting_json.get("version"),
            "author": deeting_json.get("author"),
            "description": description,
            "permissions": deeting_json.get("permissions") or [],
            "restricted": deeting_json.get("restricted", False),
            "allowed_roles": deeting_json.get("allowed_roles") or [],
            "runtime": deeting_json.get("runtime") or ["cloud", "local"],
            "execution": deeting_json.get("execution") or {"timeout_seconds": 60},
            "entry": deeting_json.get("entry") or {},
            "io_schema": tool_spec,
            "capabilities": deeting_json.get("capabilities", {}).get("tags") or [tool_spec.get("name")] if tool_spec.get("name") else [],
            "usage_spec": {
                "example_code": self._generate_example_usage(deeting_json, tool_spec)
            }
        }
        
        # Clean up None values
        return {k: v for k, v in manifest.items() if v is not None}

    def _extract_dependencies(self, deeting_json: dict, root: Path) -> list[str]:
        # Priority 1: Explicitly listed in deeting.json (if we decide to add it there)
        # Priority 2: requirements.txt
        req_path = root / "requirements.txt"
        if req_path.exists():
            lines = req_path.read_text(encoding="utf-8").splitlines()
            return [l.strip() for l in lines if l.strip() and not l.startswith("#")]
        return []

    def _extract_entrypoints(self, deeting_json: dict) -> list[str]:
        entry = deeting_json.get("entry", {})
        if isinstance(entry, dict):
            backend = entry.get("backend")
            if backend:
                return [backend]
        return ["main.py"]

    def _generate_example_usage(self, deeting_json: dict, tool_spec: dict) -> str:
        """Generates a code snippet for the Skill Registry UI/AI usage."""
        tool_name = tool_spec.get("name", "plugin_tool")
        return f"""
# Example usage of {deeting_json.get('name', 'plugin')}
# Call this tool via deeting.call_tool('{tool_name}', ...)
result = deeting.call_tool('{tool_name}', city="Beijing")
deeting.log(result)
""".strip()
