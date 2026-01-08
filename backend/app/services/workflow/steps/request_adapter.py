"""
RequestAdapterStep: 入口协议适配

用途：
- 支持 /v1/chat/completions（OpenAI）、/v1/messages（Anthropic）、/v1/responses 等多入口格式
- 将请求统一转换为内部 UIP（复用现有 ChatCompletionRequest）供后续校验/路由

注意：
- 仅在 capability="chat" 时生效，其他能力直接跳过。
"""

from __future__ import annotations

import logging
from typing import Any

from app.schemas.gateway import (
    ChatCompletionRequest,
    AnthropicMessagesRequest,
    ResponsesRequest,
)
from app.services.adapters.chat import (
    adapt_anthropic_messages,
    adapt_openai_chat,
    adapt_responses_request,
)
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

logger = logging.getLogger(__name__)


class RequestAdapterError(Exception):
    """入口适配失败"""


@step_registry.register
class RequestAdapterStep(BaseStep):
    """
    入口协议适配步骤

    从上下文读取:
        - adapter.vendor: 入口协议标识（openai/anthropic/responses）
        - adapter.raw_request: 原始请求对象（Pydantic/Dict）
        - validation.request: 若已是 ChatCompletionRequest 则可直通

    写入上下文:
        - validation.request: 统一后的 ChatCompletionRequest
    """

    name = "request_adapter"
    depends_on: list[str] = []

    async def execute(self, ctx) -> StepResult:
        # 非 chat 能力直接跳过
        if (ctx.capability or "").lower() != "chat":
            return StepResult(status=StepStatus.SUCCESS)

        vendor = (ctx.get("adapter", "vendor") or "openai").lower()
        raw_request = ctx.get("adapter", "raw_request") or ctx.get(
            "validation", "request"
        )

        if raw_request is None:
            return StepResult(
                status=StepStatus.FAILED,
                message="No request to adapt",
            )

        try:
            adapted = self._adapt_request(vendor, raw_request)
        except RequestAdapterError as exc:
            logger.warning(f"Request adaptation failed vendor={vendor}: {exc}")
            return StepResult(status=StepStatus.FAILED, message=str(exc))
        except Exception as exc:
            logger.exception(f"Request adaptation unexpected error vendor={vendor}: {exc}")
            return StepResult(status=StepStatus.FAILED, message="Request adaptation error")

        # 写回供后续校验/路由使用
        ctx.set("validation", "request", adapted)
        ctx.requested_model = adapted.model

        logger.debug(
            f"Request adapted trace_id={ctx.trace_id} vendor={vendor} model={adapted.model}"
        )

        return StepResult(
            status=StepStatus.SUCCESS,
            data={"vendor": vendor, "model": adapted.model},
        )

    def _adapt_request(self, vendor: str, raw: Any) -> ChatCompletionRequest:
        """按 vendor 适配为 ChatCompletionRequest"""
        if isinstance(raw, ChatCompletionRequest):
            return raw

        if vendor in {"openai", "chat"}:
            return adapt_openai_chat(raw)

        if vendor in {"anthropic", "messages"}:
            return adapt_anthropic_messages(raw)

        if vendor in {"responses", "response"}:
            return adapt_responses_request(raw)

        raise RequestAdapterError(f"Unsupported vendor: {vendor}")


__all__ = ["RequestAdapterStep", "RequestAdapterError"]
