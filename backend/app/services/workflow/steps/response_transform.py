"""
ResponseTransformStep: 响应转换步骤

职责：
- 字段映射（不同 provider 响应格式统一）
- 错误码翻译
- Token 用量提取
"""

import logging
from typing import TYPE_CHECKING, Any

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

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
        - routing.provider: 提供商名称

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
            # 根据 provider 转换响应
            transformed = await self._transform_response(
                response=upstream_response,
                provider=provider,
                status_code=status_code,
            )

            # 提取 usage 信息
            usage = self._extract_usage(upstream_response, provider)
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

    async def _transform_response(
        self,
        response: dict,
        provider: str | None,
        status_code: int | None,
    ) -> dict[str, Any]:
        """
        根据 provider 转换响应格式

        目标：统一为 OpenAI 格式
        """
        if not response:
            return {}

        # OpenAI 格式直接返回
        if provider == "openai":
            return response

        # Anthropic Claude 格式转换
        if provider == "anthropic":
            return self._transform_anthropic(response)

        # Azure OpenAI 格式转换
        if provider == "azure":
            return self._transform_azure(response)

        # 其他 provider 直接返回
        return response

    def _transform_anthropic(self, response: dict) -> dict:
        """Anthropic Claude 响应转换为 OpenAI 格式"""
        content = response.get("content", [])
        text = ""
        for block in content:
            if block.get("type") == "text":
                text += block.get("text", "")

        return {
            "id": response.get("id", ""),
            "object": "chat.completion",
            "created": 0,
            "model": response.get("model", ""),
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": text,
                    },
                    "finish_reason": self._map_stop_reason(
                        response.get("stop_reason")
                    ),
                }
            ],
            "usage": {
                "prompt_tokens": response.get("usage", {}).get("input_tokens", 0),
                "completion_tokens": response.get("usage", {}).get("output_tokens", 0),
                "total_tokens": (
                    response.get("usage", {}).get("input_tokens", 0)
                    + response.get("usage", {}).get("output_tokens", 0)
                ),
            },
        }

    def _transform_azure(self, response: dict) -> dict:
        """Azure OpenAI 响应转换（格式基本兼容）"""
        # Azure 格式与 OpenAI 基本一致，可能需要处理特殊字段
        return response

    def _map_stop_reason(self, stop_reason: str | None) -> str:
        """映射停止原因"""
        mapping = {
            "end_turn": "stop",
            "max_tokens": "length",
            "stop_sequence": "stop",
        }
        return mapping.get(stop_reason, stop_reason or "stop")

    def _extract_usage(self, response: dict, provider: str | None) -> dict[str, int]:
        """提取 token 用量信息"""
        usage = response.get("usage", {})

        if provider == "anthropic":
            return {
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "total_tokens": (
                    usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
                ),
            }

        # OpenAI / Azure 格式
        return {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
