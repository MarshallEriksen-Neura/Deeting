"""
SanitizeStep: 脱敏步骤

职责:
- 外部通道响应脱敏
- 移除敏感 header
- 日志脱敏处理
"""

import logging
import re
from typing import TYPE_CHECKING, Any, ClassVar

from app.core.config import settings
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepConfig, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)

# 调试类 Header (在开启内部调试时可保留)
# 默认值移至 settings.SECURITY_DEBUG_HEADERS
DEBUG_HEADERS = set(k.lower() for k in settings.SECURITY_DEBUG_HEADERS)


@step_registry.register
class SanitizeStep(BaseStep):
    """
    脱敏步骤

    从上下文读取:
        - response_transform.response: 转换后的响应
        - upstream_call.headers: 上游响应头
        - routing.response_transform: 包含脱敏规则

    写入上下文:
        - sanitize.response: 脱敏后的响应
        - sanitize.headers: 脱敏后的响应头
    """

    name: ClassVar[str] = "sanitize"
    depends_on: ClassVar[list[str]] = ["response_transform"]

    def __init__(self, config: StepConfig | None = None):
        super().__init__(config)
        # 注意: 不再默认跳过 internal, 由 execute 内部根据配置决定策略

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行脱敏处理"""
        response = ctx.get("response_transform", "response")
        headers = ctx.get("upstream_call", "headers") or {}

        # 注入亲和节省提示头（非敏感，可用于客户端展示）
        affinity_hit = ctx.get("routing", "affinity_hit")
        if affinity_hit is not None:
            headers = dict(headers)
            headers["X-GW-Affinity-Hit"] = str(bool(affinity_hit)).lower()
            saved_tokens = ctx.get("routing", "affinity_saved_tokens_est", 0)
            saved_cost = ctx.get("routing", "affinity_saved_cost_est", 0.0)
            headers["X-GW-Affinity-Saved-Tokens-Est"] = str(saved_tokens)
            headers["X-GW-Affinity-Saved-Cost-Est"] = f"{saved_cost:.6f}"

        # 获取配置规则 (从 Provider PresetItem.response_transform 中提取)
        # 格式示例: {"sanitization": {"remove_fields": ["usage"], "mask_fields": ["id"]}}
        response_transform_config = ctx.get("routing", "response_transform") or {}
        sanitization_rules = response_transform_config.get("sanitization", {})

        # 脱敏响应头
        sanitized_headers = self._sanitize_headers(headers, ctx)

        # 脱敏响应体
        sanitized_response = self._sanitize_response(response, sanitization_rules)

        # 写入上下文
        ctx.set("sanitize", "response", sanitized_response)
        ctx.set("sanitize", "headers", sanitized_headers)

        removed_count = len(headers) - len(sanitized_headers)
        if removed_count > 0:
            logger.debug(
                f"Response sanitized trace_id={ctx.trace_id} "
                f"removed_headers={removed_count}"
            )

        return StepResult(
            status=StepStatus.SUCCESS,
            data={
                "headers_removed": removed_count,
            },
        )

    def _sanitize_headers(self, headers: dict[str, str], ctx: "WorkflowContext") -> dict[str, str]:
        """脱敏响应头: 移除敏感信息"""
        sensitive_headers = set(k.lower() for k in settings.SECURITY_SENSITIVE_HEADERS)

        # 如果是内部通道且开启了调试信息, 保留调试 Header
        if ctx.is_internal and settings.INTERNAL_CHANNEL_DEBUG_INFO:
            sensitive_headers = sensitive_headers - DEBUG_HEADERS

        return {
            k: v
            for k, v in headers.items()
            if k.lower() not in sensitive_headers
        }

    def _sanitize_response(self, response: Any, rules: dict) -> Any:
        """
        脱敏响应体

        Args:
            response: 响应体数据
            rules: 脱敏规则 {"remove_fields": [], "mask_fields": []}
        """
        if response is None:
            return None

        # 1. 基础全局脱敏 (settings)
        if isinstance(response, dict):
            # 深拷贝以避免修改原对象 (如果之后还有步骤需要原始数据)
            sanitized = dict(response)

            # 移除全局敏感字段
            global_sensitive = set(settings.SECURITY_SENSITIVE_BODY_FIELDS)
            for field in global_sensitive:
                sanitized.pop(field, None)

            # 2. 按规则脱敏 (Provider/Preset Config)
            remove_fields = set(rules.get("remove_fields", []))
            for field in remove_fields:
                sanitized.pop(field, None)

            # 3. 实现 mask_fields 支持 (如 mask ID)
            mask_fields = set(rules.get("mask_fields", []))
            for field in mask_fields:
                if field in sanitized:
                    val = sanitized[field]
                    if isinstance(val, str):
                        sanitized[field] = _mask_secret(val)
                    else:
                        sanitized[field] = "[MASKED]"

            return sanitized

        return response

    @staticmethod
    def sanitize_for_log(data: Any) -> Any:
        """
        用于日志记录的脱敏处理

        将敏感字段值替换为 [REDACTED]
        """
        if isinstance(data, dict):
            sensitive_fields = set(settings.SECURITY_SENSITIVE_BODY_FIELDS)
            sanitized = {}
            for key, value in data.items():
                if key.lower() in sensitive_fields:
                    sanitized[key] = "[REDACTED]"
                else:
                    sanitized[key] = SanitizeStep.sanitize_for_log(value)
            return sanitized

        elif isinstance(data, list):
            return [SanitizeStep.sanitize_for_log(item) for item in data]

        elif isinstance(data, str):
            if _looks_like_secret(data):
                return _mask_secret(data)
            return data

        return data


def _looks_like_secret(value: str) -> bool:
    """判断字符串是否可能是密钥"""
    if not value or not isinstance(value, str):
        return False

    # 通用 API Key 模式 (sk-..., ak-..., etc)
    # 覆盖 OpenAI (sk-...), Anthropic (sk-ant-...), Google (AIza...), etc
    if re.match(r"^(sk|ak|AIza)-[a-zA-Z0-9_-]{16,}$", value):
        return True

    # Bearer token 模式
    if value.lower().startswith("bearer ") and len(value) > 15:
        return True

    # JWT 模式 (eyJ...)
    if value.startswith("eyJ") and len(value) > 30 and "." in value:
        return True

    # 阿里云 AccessKey (LTAI...)
    if re.match(r"^LTAI[a-zA-Z0-9]{16,24}$", value):
        return True

    return False


def _mask_secret(value: str) -> str:
    """遮蔽密钥,保留前后几位"""
    if len(value) <= 8:
        return "*" * len(value)

    # 对 Bearer 单独处理
    if value.startswith("Bearer "):
        token_part = value[7:]
        if len(token_part) <= 8:
            return "Bearer ********"
        return f"Bearer {token_part[:4]}...{token_part[-4:]}"

    return f"{value[:4]}...{value[-4:]}"
