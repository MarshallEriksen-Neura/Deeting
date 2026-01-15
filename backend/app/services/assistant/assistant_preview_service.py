from __future__ import annotations

from uuid import UUID

from app.repositories import (
    AssistantRepository,
    AssistantVersionRepository,
    ReviewTaskRepository,
    UserSecretaryRepository,
)
from app.schemas.gateway import ChatCompletionRequest, ChatMessage
from app.services.assistant.assistant_market_service import ensure_assistant_access


class AssistantPreviewService:
    def __init__(
        self,
        assistant_repo: AssistantRepository,
        version_repo: AssistantVersionRepository,
        review_repo: ReviewTaskRepository,
        secretary_repo: UserSecretaryRepository,
    ):
        self.assistant_repo = assistant_repo
        self.version_repo = version_repo
        self.review_repo = review_repo
        self.secretary_repo = secretary_repo

    async def build_preview_request(
        self,
        *,
        user_id: UUID,
        assistant_id: UUID,
        message: str,
        stream: bool = False,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatCompletionRequest:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            raise ValueError("助手不存在")

        await ensure_assistant_access(
            assistant=assistant,
            user_id=user_id,
            review_repo=self.review_repo,
            action="体验",
        )

        if not assistant.current_version_id:
            raise ValueError("助手未配置版本")

        version = await self.version_repo.get_for_assistant(
            assistant_id,
            assistant.current_version_id,
        )
        if not version:
            raise ValueError("助手版本不存在")

        secretary = await self.secretary_repo.get_by_user_id(user_id)
        if not secretary:
            raise ValueError("未找到用户秘书配置")
        if not secretary.model_name:
            raise ValueError("秘书模型未配置")

        return ChatCompletionRequest(
            model=secretary.model_name,
            messages=[
                ChatMessage(role="system", content=version.system_prompt),
                ChatMessage(role="user", content=message),
            ],
            stream=stream,
            temperature=temperature,
            max_tokens=max_tokens,
        )
