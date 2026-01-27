from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from uuid import UUID

from app.models.review import ReviewStatus
from app.prompts.assistant_review import ASSISTANT_REVIEW_SYSTEM_PROMPT
from app.repositories import (
    AssistantRepository,
    AssistantVersionRepository,
    UserRepository,
    UserSecretaryRepository,
)
from app.schemas.gateway import ChatCompletionRequest, ChatMessage
from app.services.orchestrator.config import INTERNAL_PREVIEW_WORKFLOW
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import GatewayOrchestrator

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AutoReviewResult:
    status: ReviewStatus
    reviewer_user_id: UUID
    reason: str | None = None
    raw_content: str | None = None


class AssistantAutoReviewService:
    def __init__(
        self,
        assistant_repo: AssistantRepository,
        user_repo: UserRepository,
        secretary_repo: UserSecretaryRepository,
        version_repo: AssistantVersionRepository | None = None,
    ):
        self.assistant_repo = assistant_repo
        self.version_repo = version_repo or AssistantVersionRepository(assistant_repo.session)
        self.user_repo = user_repo
        self.secretary_repo = secretary_repo
        self.orchestrator = GatewayOrchestrator(workflow_config=INTERNAL_PREVIEW_WORKFLOW)

    async def build_review_request(
        self,
        assistant_id: UUID,
    ) -> tuple[ChatCompletionRequest, UUID]:
        assistant = await self.assistant_repo.get(assistant_id)
        if not assistant:
            raise ValueError("助手不存在")
        if not assistant.current_version_id:
            raise ValueError("助手未配置版本")

        version = await self.version_repo.get_for_assistant(
            assistant_id,
            assistant.current_version_id,
        )
        if not version:
            raise ValueError("助手版本不存在")

        superuser = await self.user_repo.get_primary_superuser()
        secretary = None
        if superuser:
            secretary = await self.secretary_repo.get_by_user_id(superuser.id)

        if not superuser or not secretary or not secretary.model_name:
            fallback = await self.secretary_repo.get_primary_superuser_secretary()
            if fallback:
                superuser, secretary = fallback

        if not superuser:
            raise ValueError("未找到超级用户，无法自动审核")
        if not secretary:
            raise ValueError("未找到超级用户秘书配置")
        if not secretary.model_name:
            raise ValueError("超级用户秘书模型未配置")

        assistant_payload = {
            "assistant_id": str(assistant.id),
            "name": version.name,
            "summary": assistant.summary,
            "description": version.description,
            "tags": version.tags,
            "system_prompt": version.system_prompt,
        }

        prompt = json.dumps(assistant_payload, ensure_ascii=False)

        request = ChatCompletionRequest(
            model=secretary.model_name,
            messages=[
                ChatMessage(role="system", content=ASSISTANT_REVIEW_SYSTEM_PROMPT.strip()),
                ChatMessage(role="user", content=f"请审核以下助手信息：\n{prompt}"),
            ],
            stream=False,
            temperature=0.0,
            max_tokens=256,
        )
        return request, superuser.id

    async def auto_review(self, assistant_id: UUID) -> AutoReviewResult:
        request, reviewer_user_id = await self.build_review_request(assistant_id)

        ctx = WorkflowContext(
            channel=Channel.INTERNAL,
            capability="chat",
            requested_model=request.model,
            db_session=self.assistant_repo.session,
            tenant_id=str(reviewer_user_id),
            user_id=str(reviewer_user_id),
            api_key_id=str(reviewer_user_id),
        )
        ctx.set("validation", "request", request)
        ctx.set("routing", "include_public", False)

        result = await self.orchestrator.execute(ctx)
        if not result.success or not ctx.is_success:
            raise ValueError("自动审核失败")

        response = ctx.get("response_transform", "response") or {}
        content = self._extract_content(response)
        decision, reason = self.parse_review_decision(content)
        if not decision:
            raise ValueError("自动审核返回无效结果")

        return AutoReviewResult(
            status=decision,
            reviewer_user_id=reviewer_user_id,
            reason=reason,
            raw_content=content,
        )

    @staticmethod
    def parse_review_decision(content: str | None) -> tuple[ReviewStatus | None, str | None]:
        if not content:
            return None, None

        raw = content.strip()
        match = re.search(r"\{.*\}", raw, flags=re.S)
        if not match:
            return None, raw[:2000]

        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None, raw[:2000]

        decision = str(data.get("decision", "")).strip().lower()
        reason = data.get("reason")
        if isinstance(reason, str):
            reason = reason.strip()
        else:
            reason = None

        if decision in {"approve", "approved"}:
            return ReviewStatus.APPROVED, reason
        if decision in {"reject", "rejected"}:
            return ReviewStatus.REJECTED, reason
        return None, reason

    @staticmethod
    def _extract_content(response: dict) -> str:
        try:
            choices = response.get("choices") or []
            message = choices[0].get("message") if choices else {}
            content = message.get("content") if isinstance(message, dict) else None
            if content is None:
                return ""
            if isinstance(content, list):
                return "\n".join(str(item) for item in content)
            return str(content)
        except Exception as exc:  # pragma: no cover - 容错保护
            logger.warning("Failed to extract review content: %s", exc)
            return ""
