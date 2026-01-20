"""
ResponseTransformStep: 响应转换步骤

职责：
- 字段映射（不同 provider 响应格式统一）
- 错误码翻译
- Token 用量提取
"""

import logging
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus
from app.services.providers.response_transformer import response_transformer

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class ResponseTransformStep(BaseStep):
    """
    响应转换步骤

    从上下文读取:
        - upstream_call.response: 上游响应
        - upstream_call.status_code: HTTP 状态码
        - routing.template_engine: 模板引擎类型
        - routing.response_transform: 响应模板/变换规则

    写入上下文:
        - response_transform.response: 转换后的响应
        - response_transform.usage: Token 用量信息

    同时更新 ctx.billing
    """

    name = "response_transform"
    depends_on = ["upstream_call"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行响应转换"""
        upstream_response = ctx.get("upstream_call", "response")
        status_code = ctx.get("upstream_call", "status_code")
        provider = ctx.get("routing", "provider")
        template_engine = ctx.get("routing", "template_engine") or "simple_replace"
        response_transform = ctx.get("routing", "response_transform") or {}
        is_stream = ctx.get("upstream_call", "stream", False)

        # 流式响应跳过转换（流式在返回时处理）
        if is_stream:
            ctx.set("response_transform", "response", None)
            ctx.set("response_transform", "stream", True)
            return StepResult(
                status=StepStatus.SUCCESS,
                data={"stream": True},
            )

        if upstream_response is None:
            return StepResult(
                status=StepStatus.FAILED,
                message="No upstream response to transform",
            )

        try:
        # 根据模板引擎与响应规则转换响应
            item_config = SimpleNamespace(
                template_engine=template_engine,
                response_transform=response_transform,
            )
            transformed = response_transformer.transform(
                item_config=item_config,
                raw_response=upstream_response,
                status_code=status_code or 200,
            )

            # 提取 usage 信息
            usage = self._extract_usage(transformed)
            ctx.set("response_transform", "usage", usage)

            # 更新 billing 信息
            ctx.billing.input_tokens = usage.get("prompt_tokens", 0)
            ctx.billing.output_tokens = usage.get("completion_tokens", 0)
            ctx.billing.total_tokens = usage.get("total_tokens", 0)

            # 写入转换后的响应
            ctx.set("response_transform", "response", transformed)

            tool_calls = []
            if isinstance(transformed, dict):
                choices = transformed.get("choices") or []
                if choices:
                    message = choices[0].get("message") if isinstance(choices[0], dict) else None
                    if isinstance(message, dict):
                        tool_calls = message.get("tool_calls") or []
            if isinstance(tool_calls, list) and tool_calls:
                names = []
                for call in tool_calls:
                    func = call.get("function") if isinstance(call, dict) else None
                    name = None
                    if isinstance(func, dict):
                        name = func.get("name")
                    if not name and isinstance(call, dict):
                        name = call.get("name")
                    if name and name not in names:
                        names.append(name)
                if names:
                    ctx.emit_status(
                        stage="evolve",
                        step="tool_call",
                        state="running",
                        code="tool.call",
                        meta={"name": ", ".join(names[:2])},
                    )

            logger.debug(
                f"Response transformed trace_id={ctx.trace_id} "
                f"provider={provider} tokens={ctx.billing.total_tokens}"
            )

            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "tokens": ctx.billing.total_tokens,
                    "provider": provider,
                },
            )

        except Exception as e:
            logger.error(f"Response transform failed: {e}")
            # 转换失败时返回原始响应
            ctx.set("response_transform", "response", upstream_response)
            return StepResult(
                status=StepStatus.SUCCESS,
                message=f"Transform warning: {e}, using original response",
            )

    def _extract_usage(self, response: dict | None) -> dict[str, int]:
        """提取 token 用量信息（优先 OpenAI 结构，兼容常见字段）"""
        if not response:
            return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

        usage = response.get("usage") if isinstance(response, dict) else None
        usage = usage if isinstance(usage, dict) else {}

        if (
            "prompt_tokens" in usage
            or "completion_tokens" in usage
            or "total_tokens" in usage
        ):
            prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
            completion_tokens = int(usage.get("completion_tokens", 0) or 0)
            total_tokens = int(
                usage.get("total_tokens", prompt_tokens + completion_tokens) or 0
            )
            return {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            }

        if "input_tokens" in usage or "output_tokens" in usage:
            prompt_tokens = int(usage.get("input_tokens", 0) or 0)
            completion_tokens = int(usage.get("output_tokens", 0) or 0)
            return {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            }

        usage_meta = response.get("usageMetadata") or response.get("usage_metadata")
        if isinstance(usage_meta, dict):
            prompt_tokens = int(usage_meta.get("promptTokenCount", 0) or 0)
            completion_tokens = int(usage_meta.get("candidatesTokenCount", 0) or 0)
            total_tokens = int(usage_meta.get("totalTokenCount", 0) or 0)
            return {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            }

        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
