from __future__ import annotations

from typing import Any

from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.skill_registry.skill_metrics_service import SkillMetricsService


class SkillDryRunService:
    def __init__(
        self,
        repo: SkillRegistryRepository,
        executor,
        metrics_service: SkillMetricsService,
        *,
        failure_threshold: int = 3,
    ):
        self.repo = repo
        self.executor = executor
        self.metrics_service = metrics_service
        self.failure_threshold = failure_threshold

    async def run(self, skill_id: str) -> dict[str, Any]:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")

        manifest = skill.manifest_json if isinstance(skill.manifest_json, dict) else {}
        required_artifacts = _normalize_artifact_specs(manifest.get("artifacts"))
        try:
            result = await self.executor.execute(
                skill_id,
                session_id=f"dryrun:{skill_id}",
                inputs={},
                intent="dry_run",
            )
        except Exception as exc:
            return await self._handle_failure(skill, "exec_failed", str(exc))

        error_code = _validate_artifacts(required_artifacts, result.get("artifacts", []))
        if error_code:
            return await self._handle_failure(skill, error_code, None)

        await self.metrics_service.record_dry_run_success(skill_id)
        await self.repo.update(skill, {"status": "active"})
        return {
            "status": "active",
            "stdout": result.get("stdout", []),
            "stderr": result.get("stderr", []),
            "artifacts": result.get("artifacts", []),
        }

    async def _handle_failure(
        self, skill, error_code: str, error_message: str | None
    ) -> dict[str, Any]:
        metrics = await self.metrics_service.record_dry_run_failure(
            skill.id,
            error_code=error_code,
            error_message=error_message,
        )
        status = (
            "needs_review"
            if metrics.get("consecutive_failures", 0) >= self.failure_threshold
            else "dry_run_fail"
        )
        await self.repo.update(skill, {"status": status})
        return {"status": status, "error_code": error_code}


def _normalize_artifact_specs(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [item if isinstance(item, dict) else {"name": str(item)} for item in raw]
    if isinstance(raw, dict):
        return [raw]
    return [{"name": str(raw)}]


def _validate_artifacts(
    required: list[dict[str, Any]], actual: list[dict[str, Any]]
) -> str | None:
    if not required:
        return None
    index: dict[str, dict[str, Any]] = {}
    for item in actual:
        name = str(item.get("name") or "")
        path = str(item.get("path") or "")
        if name:
            index[f"name:{name}"] = item
        if path:
            index[f"path:{path}"] = item
    for spec in required:
        name = str(spec.get("name") or "")
        path = str(spec.get("path") or "")
        candidate = None
        if name:
            candidate = index.get(f"name:{name}")
        if candidate is None and path:
            candidate = index.get(f"path:{path}")
        if candidate is None:
            return "artifact_missing"
        size = candidate.get("size")
        content_base64 = candidate.get("content_base64")
        if size == 0 or (content_base64 is not None and len(str(content_base64)) == 0):
            return "artifact_empty"
    return None
