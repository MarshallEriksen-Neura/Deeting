from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any

from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.schemas.skill_self_heal import SkillSelfHealPatch, SkillSelfHealResult
from app.services.providers.llm import llm_service


class SkillSelfHealService:
    def __init__(self, repo: SkillRegistryRepository, llm_client=None, dry_run_service=None):
        self.repo = repo
        self.llm_client = llm_client or llm_service
        self.dry_run_service = dry_run_service

    async def self_heal(self, skill_id: str) -> SkillSelfHealResult:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")

        manifest = skill.manifest_json if isinstance(skill.manifest_json, dict) else {}
        payload = await self._request_patch(skill_id, manifest)
        result = SkillSelfHealResult(**payload)
        rejection = _validate_patches(result.response.patches, manifest)
        if rejection:
            updated_manifest = _append_self_heal_history(
                manifest, "rejected", result.response.patches, rejection
            )
            await self.repo.update(skill, {"manifest_json": updated_manifest})
            return _reject_result(result, rejection)
        updated_manifest = result.response.updated_manifest
        if updated_manifest is None:
            updated_manifest = _apply_patches(manifest, result.response.patches)
        if updated_manifest is not None:
            updated_manifest = _append_self_heal_history(
                updated_manifest, "success", result.response.patches, None
            )
            await self.repo.update(skill, {"manifest_json": updated_manifest})
        if self.dry_run_service is not None:
            await self.dry_run_service.run(skill_id)
        return result

    async def _request_patch(self, skill_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
        prompt = _build_prompt(skill_id, manifest)
        response = await self.llm_client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
        )
        return _parse_json_response(response)


def _build_prompt(skill_id: str, manifest: dict[str, Any]) -> str:
    return (
        "You are a Skill Self-Heal assistant. "
        "Given a failed skill manifest, return ONLY valid JSON with fields: "
        "request, response.status, response.patches, response.updated_manifest. "
        f"skill_id={skill_id}. "
        f"manifest_json={json.dumps(manifest, ensure_ascii=False)}"
    )


def _parse_json_response(response: str) -> dict[str, Any]:
    text = response.strip()
    if text.startswith("```json"):
        text = text.replace("```json", "").replace("```", "").strip()
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise RuntimeError("Self-heal response must be a JSON object")
    return payload


def _reject_result(result: SkillSelfHealResult, error_code: str) -> SkillSelfHealResult:
    result.response.status = "rejected"
    result.response.error = error_code
    result.response.updated_manifest = None
    return result


def _validate_patches(
    patches: list[SkillSelfHealPatch], manifest: dict[str, Any]
) -> str | None:
    allowed = _allowed_paths()
    for patch in patches:
        if patch.path not in allowed:
            return "unsafe_patch"
    error_code = _extract_error_code(manifest)
    if error_code:
        allowed_for_error = _allowed_paths_for_error(error_code)
        if allowed_for_error is not None:
            for patch in patches:
                if patch.path not in allowed_for_error:
                    return "error_code_mismatch"
    return None


def _allowed_paths() -> set[str]:
    return {
        "usage_spec.example_code",
        "installation.dependencies",
        "env_requirements.system_packages",
        "env_requirements.python_version",
    }


def _allowed_paths_for_error(error_code: str) -> set[str] | None:
    normalized = error_code.lower()
    if normalized in {"artifact_missing", "artifact_empty"}:
        return {"usage_spec.example_code"}
    if normalized in {"module_not_found", "import_error"}:
        return {
            "installation.dependencies",
            "env_requirements.system_packages",
            "env_requirements.python_version",
        }
    return _allowed_paths()


def _extract_error_code(manifest: dict[str, Any]) -> str | None:
    metrics = manifest.get("metrics")
    if not isinstance(metrics, dict):
        return None
    last_error = metrics.get("last_error")
    if isinstance(last_error, dict):
        code = last_error.get("code")
        return str(code) if code else None
    return None


def _apply_patches(
    manifest: dict[str, Any], patches: list[SkillSelfHealPatch]
) -> dict[str, Any]:
    updated = copy.deepcopy(manifest)
    for patch in patches:
        if patch.action != "set":
            continue
        _set_path(updated, patch.path, patch.value)
    return updated


def _set_path(target: dict[str, Any], path: str, value: Any) -> None:
    parts = [segment for segment in path.split(".") if segment]
    if not parts:
        return
    cursor: Any = target
    for key in parts[:-1]:
        if not isinstance(cursor, dict):
            return
        if key not in cursor or not isinstance(cursor.get(key), dict):
            cursor[key] = {}
        cursor = cursor[key]
    if isinstance(cursor, dict):
        cursor[parts[-1]] = value


def _append_self_heal_history(
    manifest: dict[str, Any],
    status: str,
    patches: list[SkillSelfHealPatch],
    error_code: str | None,
) -> dict[str, Any]:
    updated = copy.deepcopy(manifest)
    metrics = updated.get("metrics")
    if not isinstance(metrics, dict):
        metrics = {}
    history = metrics.get("self_heal_history")
    if not isinstance(history, list):
        history = []
    entry: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "changes": [patch.path for patch in patches],
    }
    if error_code:
        entry["error"] = error_code
    history.append(entry)
    metrics["self_heal_history"] = history
    updated["metrics"] = metrics
    return updated
