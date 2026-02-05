from __future__ import annotations

from typing import Any

from app.repositories.skill_registry_repository import SkillRegistryRepository


class SkillMetricsService:
    def __init__(self, repo: SkillRegistryRepository, failure_threshold: int = 10):
        self.repo = repo
        self.failure_threshold = failure_threshold

    async def record_success(self, skill_id: str) -> dict[str, Any]:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        metrics = _extract_metrics(skill.manifest_json)
        metrics["total_runs"] += 1
        metrics["success_runs"] += 1
        metrics["consecutive_failures"] = 0
        metrics["success_rate"] = _compute_rate(
            metrics["success_runs"], metrics["total_runs"]
        )
        payload = {"manifest_json": _merge_metrics(skill.manifest_json, metrics)}
        await self.repo.update(skill, payload)
        return metrics

    async def record_failure(
        self, skill_id: str, error: str | None = None
    ) -> dict[str, Any]:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        metrics = _extract_metrics(skill.manifest_json)
        metrics["total_runs"] += 1
        metrics["consecutive_failures"] += 1
        metrics["failure_count"] += 1
        if error:
            metrics["last_error"] = error
        metrics["success_rate"] = _compute_rate(
            metrics["success_runs"], metrics["total_runs"]
        )
        payload: dict[str, Any] = {
            "manifest_json": _merge_metrics(skill.manifest_json, metrics)
        }
        if metrics["consecutive_failures"] >= self.failure_threshold:
            payload["status"] = "disabled"
        await self.repo.update(skill, payload)
        return metrics

    async def record_dry_run_success(self, skill_id: str) -> dict[str, Any]:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        metrics = _extract_metrics(skill.manifest_json)
        metrics["dry_run_total"] += 1
        metrics["dry_run_success"] += 1
        metrics["consecutive_failures"] = 0
        payload = {"manifest_json": _merge_metrics(skill.manifest_json, metrics)}
        await self.repo.update(skill, payload)
        return metrics

    async def record_dry_run_failure(
        self,
        skill_id: str,
        *,
        error_code: str,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        metrics = _extract_metrics(skill.manifest_json)
        metrics["dry_run_total"] += 1
        metrics["dry_run_fail"] += 1
        metrics["consecutive_failures"] += 1
        metrics["last_error"] = {"code": error_code, "message": error_message}
        payload: dict[str, Any] = {
            "manifest_json": _merge_metrics(skill.manifest_json, metrics)
        }
        await self.repo.update(skill, payload)
        return metrics

    async def record_feedback(self, skill_id: str, score: float) -> dict[str, Any]:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        metrics = _extract_metrics(skill.manifest_json)
        previous_total = metrics["feedback_total"]
        metrics["feedback_total"] += 1
        if score > 0:
            metrics["feedback_positive"] += 1
        elif score < 0:
            metrics["feedback_negative"] += 1
        metrics["semantic_score"] = _compute_semantic_score(
            previous_score=metrics["semantic_score"],
            previous_total=previous_total,
            score=score,
        )
        payload = {"manifest_json": _merge_metrics(skill.manifest_json, metrics)}
        await self.repo.update(skill, payload)
        return metrics


def _extract_metrics(manifest: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        manifest = {}
    raw = manifest.get("metrics")
    if not isinstance(raw, dict):
        raw = {}
    return {
        "total_runs": int(raw.get("total_runs", 0) or 0),
        "success_runs": int(raw.get("success_runs", 0) or 0),
        "consecutive_failures": int(raw.get("consecutive_failures", 0) or 0),
        "success_rate": float(raw.get("success_rate", 0.0) or 0.0),
        "last_error": raw.get("last_error"),
        "dry_run_total": int(raw.get("dry_run_total", 0) or 0),
        "dry_run_success": int(raw.get("dry_run_success", 0) or 0),
        "dry_run_fail": int(raw.get("dry_run_fail", 0) or 0),
        "feedback_total": int(raw.get("feedback_total", 0) or 0),
        "feedback_positive": int(raw.get("feedback_positive", 0) or 0),
        "feedback_negative": int(raw.get("feedback_negative", 0) or 0),
        "semantic_score": float(raw.get("semantic_score", 0.0) or 0.0),
        "failure_count": int(raw.get("failure_count", 0) or 0),
    }


def _merge_metrics(
    manifest: dict[str, Any] | None, metrics: dict[str, Any]
) -> dict[str, Any]:
    base = dict(manifest or {})
    base["metrics"] = metrics
    return base


def _compute_rate(success_runs: int, total_runs: int) -> float:
    if total_runs <= 0:
        return 0.0
    return success_runs / total_runs


def _compute_semantic_score(
    *, previous_score: float, previous_total: int, score: float
) -> float:
    if previous_total <= 0:
        return float(score)
    return (previous_score * previous_total + score) / (previous_total + 1)
