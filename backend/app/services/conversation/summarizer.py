from __future__ import annotations

import textwrap
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.models.secretary import UserSecretary
from app.prompts.conversation_summary import CONVERSATION_SUMMARY_PROMPT_TEMPLATE
from app.repositories.provider_instance_repository import ProviderModelRepository
from app.services.providers.provider_instance_service import ProviderInstanceService


class SummarizerService:
    """
    对话摘要服务：
    - 使用用户自己的秘书模型生成摘要
    - 若用户未配置秘书模型，回退为本地轻量摘要
    """

    def __init__(self, db: AsyncSession, user_id: str | None = None) -> None:
        self.db = db
        self.user_id = user_id
        self.max_tokens = settings.CONVERSATION_SUMMARY_MAX_TOKENS

    async def summarize(self, messages: list[dict[str, Any]]) -> tuple[str, str | None]:
        """
        生成摘要。返回 (summary_text, model_name)。
        model_name 为 None 表示使用了本地轻量回退。
        """
        if not messages:
            return "", None

        if self.user_id:
            result = await self._summarize_with_secretary(messages)
            if result is not None:
                return result

        logger.info("conversation_summarizer_fallback_local user_id=%s", self.user_id)
        return self._local_fallback(messages), None

    async def _summarize_with_secretary(
        self, messages: list[dict[str, Any]]
    ) -> tuple[str, str | None] | None:
        """尝试使用用户秘书模型生成摘要，失败返回 None 以回退。"""
        try:
            user_uuid = uuid.UUID(self.user_id)  # type: ignore[arg-type]
        except (ValueError, TypeError):
            return None

        stmt = select(UserSecretary).where(UserSecretary.user_id == user_uuid)
        result = await self.db.execute(stmt)
        secretary = result.scalar_one_or_none()
        if not secretary or not secretary.model_name:
            return None

        model_repo = ProviderModelRepository(self.db)
        candidates = await model_repo.get_candidates(
            capability="chat",
            model_id=secretary.model_name,
            user_id=str(user_uuid),
            include_public=False,
        )
        if not candidates:
            return None

        model = candidates[0]
        conversation_text = self._format_messages(messages)
        prompt = CONVERSATION_SUMMARY_PROMPT_TEMPLATE.format(conversation=conversation_text)

        try:
            service = ProviderInstanceService(self.db)
            response = await service.test_model(
                model_id=model.id,
                user_id=user_uuid,
                prompt=prompt,
            )
        except Exception as exc:
            logger.warning("conversation_summarizer_call_failed user=%s exc=%s", self.user_id, exc)
            return None

        if not isinstance(response, dict) or not response.get("success"):
            return None

        summary_text = self._extract_text(response.get("response_body"))
        if not summary_text:
            return None

        return summary_text, secretary.model_name

    @staticmethod
    def _format_messages(messages: list[dict[str, Any]]) -> str:
        """将消息列表格式化为文本，供 prompt 使用。"""
        lines = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "") or ""
            lines.append(f"[{role}] {content}")
        return "\n".join(lines)

    @staticmethod
    def _extract_text(response_body: Any) -> str | None:
        """从模型返回中提取文本内容，兼容多种格式。"""
        if isinstance(response_body, dict):
            choices = response_body.get("choices")
            if isinstance(choices, list) and choices:
                first = choices[0]
                if isinstance(first, dict):
                    message = first.get("message")
                    if isinstance(message, dict):
                        content = message.get("content")
                        if isinstance(content, str) and content.strip():
                            return content.strip()
                    text = first.get("text")
                    if isinstance(text, str) and text.strip():
                        return text.strip()
            content = response_body.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()
            if isinstance(content, list) and content:
                first_part = content[0]
                if isinstance(first_part, dict):
                    text = first_part.get("text")
                    if isinstance(text, str) and text.strip():
                        return text.strip()
            completion = response_body.get("completion")
            if isinstance(completion, str) and completion.strip():
                return completion.strip()
        if isinstance(response_body, str) and response_body.strip():
            return response_body.strip()
        return None

    @staticmethod
    def _local_fallback(messages: list[dict[str, Any]]) -> str:
        """本地轻量摘要回退：拼接最近几轮消息。"""
        lines = []
        recent = messages[-8:]
        for msg in recent:
            role = msg.get("role", "user")
            content = msg.get("content", "") or ""
            lines.append(f"[{role}] {content}")
        summary = "\n".join(lines)
        return textwrap.shorten(summary, width=2000, placeholder=" ...")
