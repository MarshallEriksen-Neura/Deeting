from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants.assistants import DEFAULT_ASSISTANT_SLUG
from app.core.logging import logger
from app.repositories.assistant_install_repository import AssistantInstallRepository
from app.repositories.assistant_repository import AssistantRepository


class DefaultAssistantService:
    """确保用户拥有默认助手的安装记录。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.assistant_repo = AssistantRepository(session)
        self.install_repo = AssistantInstallRepository(session)

    async def ensure_installed(self, user_id: UUID) -> bool:
        assistant = await self.assistant_repo.get_by_share_slug(DEFAULT_ASSISTANT_SLUG)
        if not assistant:
            logger.warning(
                "default_assistant_missing",
                extra={"assistant_slug": DEFAULT_ASSISTANT_SLUG, "user_id": str(user_id)},
            )
            return False

        existing = await self.install_repo.get_by_user_and_assistant(user_id, assistant.id)
        if existing:
            return False

        try:
            await self.install_repo.create(
                {
                    "user_id": user_id,
                    "assistant_id": assistant.id,
                }
            )
        except IntegrityError:
            await self.session.rollback()
            return False

        await self._refresh_install_count(assistant.id)
        logger.info(
            "default_assistant_installed",
            extra={"assistant_id": str(assistant.id), "user_id": str(user_id)},
        )
        return True

    async def _refresh_install_count(self, assistant_id: UUID) -> None:
        try:
            count = await self.install_repo.count_by_assistant(assistant_id)
            assistant = await self.assistant_repo.get(assistant_id)
            if not assistant:
                return
            await self.assistant_repo.update(assistant, {"install_count": count})
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "default_assistant_install_count_failed",
                extra={"assistant_id": str(assistant_id), "error": str(exc)},
            )
