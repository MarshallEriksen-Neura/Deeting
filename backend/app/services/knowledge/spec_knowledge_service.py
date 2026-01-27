from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Dict, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.config import settings
from app.models.spec_agent import SpecPlan
from app.models.spec_knowledge import SpecKnowledgeCandidate
from app.repositories.review_repository import ReviewTaskRepository
from app.repositories.spec_agent_repository import SpecAgentRepository
from app.repositories.spec_knowledge_repository import SpecKnowledgeCandidateRepository
from app.services.providers.embedding import EmbeddingService
from app.services.providers.llm import llm_service
from app.services.review.review_service import ReviewService
from app.storage.qdrant_kb_collections import (
    get_kb_candidates_collection_name,
    get_kb_system_collection_name,
)
from app.storage.qdrant_kb_store import ensure_collection_vector_size, upsert_point, delete_points
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.utils.time_utils import Datetime
from app.prompts.spec_knowledge_review import SPEC_KB_REVIEW_SYSTEM_PROMPT

logger = logging.getLogger(__name__)


SPEC_KB_REVIEW_ENTITY = "spec_knowledge_candidate"

STATUS_PENDING_SIGNAL = "pending_signal"
STATUS_PENDING_EVAL = "pending_eval"
STATUS_PENDING_REVIEW = "pending_review"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_DISABLED = "disabled"

POSITIVE_EVENTS = {"approve", "thumbs_up", "applied", "deploy", "copied"}
NEGATIVE_EVENTS = {"reject", "thumbs_down", "revert", "rollback", "error", "failed"}
APPLY_EVENTS = {"applied", "deploy"}
REVERT_EVENTS = {"revert", "rollback"}
ERROR_EVENTS = {"error", "failed"}


@dataclass(frozen=True)
class GuardRule:
    rule_id: str
    pattern: re.Pattern[str]
    description: str


STATIC_GUARD_RULES: Tuple[GuardRule, ...] = (
    GuardRule("danger.rm_rf_root", re.compile(r"\brm\s+-rf\s+/\b", re.I), "危险删除指令"),
    GuardRule("danger.mkfs", re.compile(r"\bmkfs\.", re.I), "磁盘格式化指令"),
    GuardRule("danger.dd", re.compile(r"\bdd\s+if=", re.I), "磁盘覆写指令"),
    GuardRule("danger.drop_db", re.compile(r"\bdrop\s+database\b", re.I), "数据库删除指令"),
    GuardRule("danger.drop_table", re.compile(r"\bdrop\s+table\b", re.I), "数据表删除指令"),
    GuardRule("danger.truncate", re.compile(r"\btruncate\s+table\b", re.I), "数据表清空指令"),
    GuardRule("danger.exec_pipe", re.compile(r"\b(curl|wget).*\|\s*(sh|bash|zsh)\b", re.I), "下载即执行"),
    GuardRule("danger.sudoers", re.compile(r"sudoers|authorized_keys", re.I), "权限持久化/授权"),
    GuardRule("secret.openai", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"), "疑似 API Key"),
    GuardRule("secret.aws", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "疑似云密钥"),
)


class SpecKnowledgeVectorService:
    def __init__(self, embedding_service: EmbeddingService | None = None):
        self._embedding_service = embedding_service or EmbeddingService()

    async def upsert_candidate(self, *, point_id: str, content: str, payload: dict[str, Any]) -> bool:
        if not qdrant_is_configured():
            return False
        try:
            vector = await self._embedding_service.embed_text(content)
            client = get_qdrant_client()
            collection_name = get_kb_candidates_collection_name()
            await ensure_collection_vector_size(
                client,
                collection_name=collection_name,
                vector_size=len(vector),
            )
            await upsert_point(
                client,
                collection_name=collection_name,
                point_id=point_id,
                vector=vector,
                payload=payload,
                wait=True,
            )
            return True
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("spec_kb_candidate_upsert_failed: %s", exc)
            return False

    async def upsert_system(self, *, point_id: str, content: str, payload: dict[str, Any]) -> bool:
        if not qdrant_is_configured():
            return False
        try:
            vector = await self._embedding_service.embed_text(content)
            client = get_qdrant_client()
            collection_name = get_kb_system_collection_name()
            await ensure_collection_vector_size(
                client,
                collection_name=collection_name,
                vector_size=len(vector),
            )
            await upsert_point(
                client,
                collection_name=collection_name,
                point_id=point_id,
                vector=vector,
                payload=payload,
                wait=True,
            )
            return True
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("spec_kb_system_upsert_failed: %s", exc)
            return False

    async def delete_candidate(self, *, point_id: str) -> None:
        if not qdrant_is_configured():
            return
        try:
            client = get_qdrant_client()
            await delete_points(
                client,
                collection_name=get_kb_candidates_collection_name(),
                points_ids=[point_id],
                wait=True,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("spec_kb_candidate_delete_failed: %s", exc)


class SpecKnowledgeService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = SpecKnowledgeCandidateRepository(session)
        self.spec_repo = SpecAgentRepository(session)
        self.review_repo = ReviewTaskRepository(session)
        self.review_service = ReviewService(self.review_repo)
        self.vector_service = SpecKnowledgeVectorService()

    async def record_feedback_event(
        self,
        *,
        user_id: uuid.UUID,
        plan_id: uuid.UUID,
        event: str,
        payload: dict[str, Any] | None = None,
    ) -> SpecKnowledgeCandidate | None:
        plan = await self.spec_repo.get_plan(plan_id)
        if not plan or plan.user_id != user_id:
            return None

        payload = payload or {}
        event_lower = event.strip().lower()
        feedback, apply, revert, error = self._classify_event(event_lower, payload)
        if feedback is None and not (apply or revert or error):
            return None

        canonical_hash, normalized_manifest = self._build_canonical_hash(plan.manifest_data)
        candidate = await self.repo.get_by_hash(canonical_hash)
        if not candidate:
            candidate = SpecKnowledgeCandidate(
                canonical_hash=canonical_hash,
                user_id=user_id,
                plan_id=plan.id,
                manifest_data=plan.manifest_data or {},
                normalized_manifest=normalized_manifest,
                status=STATUS_PENDING_SIGNAL,
            )
            self.session.add(candidate)
            await self.session.flush()
        else:
            if not candidate.plan_id:
                candidate.plan_id = plan.id
            if not candidate.user_id:
                candidate.user_id = user_id

        now = Datetime.now()

        if feedback == "positive":
            candidate.positive_feedback += 1
            candidate.last_positive_at = now
            if candidate.status in {STATUS_PENDING_SIGNAL, STATUS_REJECTED}:
                candidate.status = STATUS_PENDING_EVAL
        elif feedback == "negative":
            candidate.negative_feedback += 1
            candidate.last_negative_at = now

        run_increment = 1 if (apply or revert or error) else 0
        if apply:
            candidate.apply_count += 1
            candidate.last_applied_at = now
            if not error:
                candidate.success_runs += 1
        if revert:
            candidate.revert_count += 1
            candidate.last_reverted_at = now
        if error:
            candidate.error_count += 1
        if run_increment:
            candidate.total_runs += run_increment

        if candidate.negative_feedback > candidate.positive_feedback:
            candidate.status = STATUS_REJECTED
            candidate.eval_snapshot = {"blocked": "negative_signal"}

        session_hash = self._hash_session(plan)
        if session_hash:
            hashes = list(candidate.session_hashes or [])
            if session_hash not in hashes:
                hashes.append(session_hash)
            candidate.session_hashes = hashes[-200:]

        await self.session.commit()
        await self.session.refresh(candidate)

        if candidate.status == STATUS_REJECTED and candidate.negative_feedback > candidate.positive_feedback:
            await self.vector_service.delete_candidate(point_id=candidate.canonical_hash)

        self._maybe_schedule_evaluation(candidate)
        self._maybe_schedule_auto_promote(candidate)
        return candidate

    async def evaluate_candidate(self, candidate_id: uuid.UUID) -> str:
        candidate = await self.repo.get(candidate_id)
        if not candidate:
            return "not_found"
        if candidate.status in {STATUS_APPROVED, STATUS_DISABLED}:
            return "skipped"

        now = Datetime.now()
        if not candidate.last_positive_at:
            return "no_positive_signal"
        if candidate.last_negative_at and candidate.last_negative_at > candidate.last_positive_at:
            candidate.status = STATUS_REJECTED
            candidate.eval_snapshot = {"blocked": "negative_signal"}
            await self.session.commit()
            return "negative_signal"

        window_seconds = int(settings.SPEC_KB_OBSERVATION_WINDOW_SECONDS or 0)
        if window_seconds > 0:
            since_positive = (now - candidate.last_positive_at).total_seconds()
            if since_positive < window_seconds:
                return "window_not_reached"

        static_pass, static_reason = self._run_static_guard(candidate.manifest_data or {})
        if not static_pass:
            candidate.eval_static_pass = False
            candidate.eval_reason = static_reason
            candidate.eval_snapshot = {"static_pass": False, "reason": static_reason}
            candidate.status = STATUS_REJECTED
            candidate.last_eval_at = now
            await self.session.commit()
            await self.vector_service.delete_candidate(point_id=candidate.canonical_hash)
            return "static_blocked"

        llm_score, llm_reason = await self._run_llm_review(
            candidate.manifest_data or {},
            user_id=candidate.user_id,
        )
        candidate.eval_static_pass = True
        candidate.eval_llm_score = llm_score
        candidate.eval_reason = llm_reason
        candidate.eval_snapshot = {
            "static_pass": True,
            "llm_score": llm_score,
            "critic_reason": llm_reason,
        }
        candidate.last_eval_at = now

        if llm_score is None or llm_score < int(settings.SPEC_KB_EVAL_MIN_SCORE or 0):
            candidate.status = STATUS_REJECTED
            await self.session.commit()
            await self.vector_service.delete_candidate(point_id=candidate.canonical_hash)
            return "llm_rejected"

        candidate.status = STATUS_PENDING_REVIEW
        await self.session.commit()
        await self._submit_review_task(candidate)
        await self._sync_candidate_to_qdrant(candidate)
        return "ok"

    async def promote_candidate(
        self,
        candidate_id: uuid.UUID,
        *,
        reviewer_user_id: uuid.UUID | None = None,
        reason: str | None = None,
        auto: bool = False,
    ) -> bool:
        candidate = await self.repo.get(candidate_id)
        if not candidate:
            return False
        if candidate.status != STATUS_PENDING_REVIEW:
            return False

        candidate.status = STATUS_APPROVED
        candidate.promoted_at = Datetime.now()
        await self.session.commit()
        await self._sync_candidate_to_qdrant(candidate)
        await self._sync_candidate_to_system(candidate)

        try:
            await self.review_service.approve(
                entity_type=SPEC_KB_REVIEW_ENTITY,
                entity_id=candidate.id,
                reviewer_user_id=reviewer_user_id,
                reason=reason or ("auto_promote" if auto else None),
            )
        except ValueError:
            if not auto:
                raise
        return True

    async def reject_candidate(
        self,
        candidate_id: uuid.UUID,
        *,
        reviewer_user_id: uuid.UUID | None = None,
        reason: str | None = None,
    ) -> bool:
        candidate = await self.repo.get(candidate_id)
        if not candidate:
            return False
        candidate.status = STATUS_REJECTED
        await self.session.commit()
        await self.vector_service.delete_candidate(point_id=candidate.canonical_hash)
        try:
            await self.review_service.reject(
                entity_type=SPEC_KB_REVIEW_ENTITY,
                entity_id=candidate.id,
                reviewer_user_id=reviewer_user_id,
                reason=reason,
            )
        except ValueError:
            logger.info("spec_kb_review_task_missing", extra={"candidate_id": str(candidate.id)})
        return True

    @staticmethod
    def _hash_session(plan: SpecPlan) -> str | None:
        session_id = plan.conversation_session_id or plan.id
        if not session_id:
            return None
        raw = str(session_id)
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]

    @staticmethod
    def _normalize_manifest(manifest: Dict[str, Any]) -> Dict[str, Any]:
        raw = json.loads(json.dumps(manifest, ensure_ascii=False, default=str))
        if isinstance(raw, dict):
            raw.pop("context", None)
            raw.pop("project_name", None)
            nodes = raw.get("nodes")
            if isinstance(nodes, list):
                for node in nodes:
                    if isinstance(node, dict):
                        node.pop("desc", None)
                        node.pop("model_override", None)
                        node.pop("pending_instruction", None)
                        rules = node.get("rules")
                        if isinstance(rules, list):
                            node["rules"] = sorted(
                                rules,
                                key=lambda r: json.dumps(r, ensure_ascii=False, sort_keys=True),
                            )
                raw["nodes"] = sorted(nodes, key=lambda n: str(n.get("id", "")))
        return raw

    def _build_canonical_hash(self, manifest: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        normalized = self._normalize_manifest(manifest or {})
        payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return digest, normalized

    @staticmethod
    def _classify_event(event: str, payload: dict[str, Any]) -> Tuple[str | None, bool, bool, bool]:
        if event in APPLY_EVENTS:
            success_flag = payload.get("success")
            error_flag = payload.get("error") or payload.get("error_code")
            if success_flag is False or error_flag:
                return "negative", True, False, True
            return "positive", True, False, False
        if event in POSITIVE_EVENTS:
            return "positive", False, False, False
        if event in NEGATIVE_EVENTS:
            return "negative", False, event in REVERT_EVENTS, event in ERROR_EVENTS

        if event == "edit":
            edit_distance = payload.get("edit_distance")
            try:
                if edit_distance is not None and float(edit_distance) >= float(
                    settings.SPEC_KB_EDIT_DISTANCE_THRESHOLD or 0
                ):
                    return "negative", False, False, False
            except (TypeError, ValueError):
                return None, False, False, False
        return None, False, False, False

    @staticmethod
    def _run_static_guard(manifest: Dict[str, Any]) -> Tuple[bool, str | None]:
        raw_text = json.dumps(manifest, ensure_ascii=False, default=str)
        for rule in STATIC_GUARD_RULES:
            if rule.pattern.search(raw_text):
                return False, f"{rule.rule_id}:{rule.description}"
        return True, None

    async def _run_llm_review(
        self,
        manifest: Dict[str, Any],
        *,
        user_id: uuid.UUID | None = None,
    ) -> Tuple[int | None, str | None]:
        payload = json.dumps(manifest, ensure_ascii=False, default=str)
        model = getattr(settings, "SPEC_KB_EVAL_MODEL", None) or None
        try:
            response = await llm_service.chat_completion(
                messages=[
                    {"role": "system", "content": SPEC_KB_REVIEW_SYSTEM_PROMPT.strip()},
                    {"role": "user", "content": payload},
                ],
                model=model,
                temperature=0.0,
                max_tokens=256,
                user_id=str(user_id) if user_id else None,
                tenant_id=str(user_id) if user_id else None,
                api_key_id=str(user_id) if user_id else None,
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("spec_kb_llm_review_failed: %s", exc)
            return None, "llm_review_failed"

        score, reason = self._parse_llm_review(response)
        return score, reason

    @staticmethod
    def _parse_llm_review(raw: Any) -> Tuple[int | None, str | None]:
        if raw is None:
            return None, None
        content = str(raw).strip()
        match = re.search(r"\{.*\}", content, flags=re.S)
        if not match:
            return None, content[:2000]
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None, content[:2000]
        score = data.get("score")
        reason = data.get("reason")
        try:
            score_val = int(score) if score is not None else None
        except (TypeError, ValueError):
            score_val = None
        reason_val = str(reason).strip() if isinstance(reason, str) else None
        return score_val, reason_val

    async def _submit_review_task(self, candidate: SpecKnowledgeCandidate) -> None:
        payload = {
            "canonical_hash": candidate.canonical_hash,
            "eval_snapshot": candidate.eval_snapshot,
        }
        await self.review_service.submit(
            entity_type=SPEC_KB_REVIEW_ENTITY,
            entity_id=candidate.id,
            submitter_user_id=candidate.user_id,
            payload=payload,
        )

    async def _sync_candidate_to_qdrant(self, candidate: SpecKnowledgeCandidate) -> None:
        payload = self._build_qdrant_payload(candidate)
        content = json.dumps(candidate.normalized_manifest, ensure_ascii=False, default=str)
        await self.vector_service.upsert_candidate(
            point_id=candidate.canonical_hash,
            content=content,
            payload=payload,
        )

    async def _sync_candidate_to_system(self, candidate: SpecKnowledgeCandidate) -> None:
        payload = self._build_qdrant_payload(candidate, system_scope=True)
        content = json.dumps(candidate.normalized_manifest, ensure_ascii=False, default=str)
        await self.vector_service.upsert_system(
            point_id=candidate.canonical_hash,
            content=content,
            payload=payload,
        )

    @staticmethod
    def _build_qdrant_payload(
        candidate: SpecKnowledgeCandidate,
        *,
        system_scope: bool = False,
    ) -> dict[str, Any]:
        usage_stats = {
            "sessions": len(candidate.session_hashes or []),
            "total_runs": candidate.total_runs,
            "success_runs": candidate.success_runs,
            "apply_count": candidate.apply_count,
            "revert_count": candidate.revert_count,
            "error_count": candidate.error_count,
            "positive_feedback": candidate.positive_feedback,
            "negative_feedback": candidate.negative_feedback,
        }
        total_runs = candidate.total_runs or 0
        usage_stats["success_rate"] = (
            candidate.success_runs / total_runs if total_runs > 0 else 0.0
        )
        payload = {
            "canonical_hash": candidate.canonical_hash,
            "usage_stats": usage_stats,
            "revert_count": candidate.revert_count,
            "eval_snapshot": candidate.eval_snapshot,
            "trust_weight": candidate.trust_weight,
            "exploration_tag": candidate.exploration_tag,
            "status": candidate.status,
            "created_at": candidate.created_at.isoformat() if candidate.created_at else None,
            "updated_at": candidate.updated_at.isoformat() if candidate.updated_at else None,
        }
        if not system_scope:
            payload["user_id"] = str(candidate.user_id) if candidate.user_id else None
            payload["plan_id"] = str(candidate.plan_id) if candidate.plan_id else None
        return payload

    @staticmethod
    def _celery_available() -> bool:
        broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
        return bool(broker)

    def _maybe_schedule_evaluation(self, candidate: SpecKnowledgeCandidate) -> None:
        if candidate.status != STATUS_PENDING_EVAL:
            return
        if not self._celery_available():
            return
        delay = int(settings.SPEC_KB_OBSERVATION_WINDOW_SECONDS or 0)
        celery_app.send_task(
            "app.tasks.spec_knowledge.evaluate_candidate",
            args=[str(candidate.id)],
            countdown=max(delay, 0),
        )

    def _maybe_schedule_auto_promote(self, candidate: SpecKnowledgeCandidate) -> None:
        if candidate.status != STATUS_PENDING_REVIEW:
            return
        if not self._celery_available():
            return
        auto_sessions = int(settings.SPEC_KB_AUTO_PROMOTE_UNIQUE_SESSIONS or 0)
        if auto_sessions <= 0:
            return
        if len(candidate.session_hashes or []) < auto_sessions:
            return
        window_days = int(settings.SPEC_KB_AUTO_PROMOTE_WINDOW_DAYS or 0)
        if window_days > 0 and candidate.last_positive_at:
            if candidate.last_positive_at < Datetime.now() - timedelta(days=window_days):
                return
        celery_app.send_task(
            "app.tasks.spec_knowledge.auto_promote_candidate",
            args=[str(candidate.id)],
            countdown=5,
        )


__all__ = [
    "SpecKnowledgeService",
    "SpecKnowledgeVectorService",
    "SPEC_KB_REVIEW_ENTITY",
    "STATUS_PENDING_SIGNAL",
    "STATUS_PENDING_EVAL",
    "STATUS_PENDING_REVIEW",
    "STATUS_APPROVED",
    "STATUS_REJECTED",
    "STATUS_DISABLED",
]
