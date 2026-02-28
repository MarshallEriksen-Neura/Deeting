from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select

from app.core.sandbox.manager import sandbox_manager
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.skill_registry.runtimes.backend_task import BackendTaskRuntimeStrategy
from app.services.skill_registry.runtimes.base import (
    BaseRuntimeStrategy,
    RuntimeContext,
)
from app.services.skill_registry.runtimes.sandbox import SandboxRuntimeStrategy

logger = logging.getLogger(__name__)


class SkillRuntimeExecutor:
    def __init__(
        self,
        repo: SkillRegistryRepository,
        sandbox_manager=sandbox_manager,
    ):
        self.repo = repo
        self.sandbox_manager = sandbox_manager

        # Strategy Registry: Maps runtime strings to strategy implementations
        self.strategies: dict[str, BaseRuntimeStrategy] = {
            "backend_task": BackendTaskRuntimeStrategy(),
            "opensandbox": SandboxRuntimeStrategy(),
            # Future extensions can be added here
            # "crawler": CrawlerRuntimeStrategy(),
        }
        # Backward-compatible aliases persisted by ingestion/API.
        self.runtime_aliases: dict[str, str] = {
            "python_library": "opensandbox",
            "node_library": "opensandbox",
        }

    async def execute(
        self,
        skill_id: str,
        *,
        session_id: str | None,
        user_id: str | uuid.UUID | None = None,
        intent: str | None = None,
        inputs: dict[str, Any],
        kill_on_exit: bool = False,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")
        await self._ensure_user_skill_access(skill, user_id=user_id, intent=intent)

        runtime_type = (
            str(skill.runtime or "opensandbox").strip().lower() or "opensandbox"
        )
        runtime_type = self.runtime_aliases.get(runtime_type, runtime_type)
        strategy = self.strategies.get(runtime_type)

        if not strategy:
            # Fallback for legacy skills without explicit runtime
            strategy = self.strategies["opensandbox"]
            logger.warning(
                f"Unknown runtime '{runtime_type}' for skill '{skill_id}'. Falling back to opensandbox."
            )

        context = RuntimeContext(
            session_id=session_id,
            user_id=user_id,
            sandbox_manager=self.sandbox_manager,
            intent=intent,
            kill_on_exit=kill_on_exit,
            trace_id=trace_id,
        )

        return await strategy.execute(skill, inputs, context)

    async def _ensure_user_skill_access(
        self,
        skill,
        *,
        user_id: str | uuid.UUID | None,
        intent: str | None = None,
    ) -> None:
        if intent == "dry_run":
            return
        # System/local seeded skills keep existing behavior.
        if not getattr(skill, "source_repo", None):
            return

        if not user_id:
            raise ValueError("Skill requires authenticated user installation")
        try:
            uid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
        except (ValueError, TypeError) as exc:
            raise ValueError("Skill requires valid user_id") from exc

        session = getattr(self.repo, "session", None)
        if session is None:
            logger.warning("SkillRuntimeExecutor: missing repo session, skip install check")
            return

        from app.models.user_skill_installation import UserSkillInstallation

        stmt = select(UserSkillInstallation.id).where(
            UserSkillInstallation.user_id == uid,
            UserSkillInstallation.skill_id == str(skill.id),
            UserSkillInstallation.is_enabled == True,
        )
        result = await session.execute(stmt)
        installed_id = result.scalar_one_or_none()
        if installed_id is None:
            raise ValueError("Skill not installed for current user")
