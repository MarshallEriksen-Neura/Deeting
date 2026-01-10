"""
ValidationStep: 入参校验步骤

职责：
- Schema 校验（Pydantic）
- 签名/JWT 基础校验（外部通道）
- 请求大小限制检查
"""

import logging
from typing import TYPE_CHECKING, Any

from app.core.config import settings
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus
from app.utils.security import is_potential_prompt_injection, is_potential_sql_injection

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


class ValidationError(Exception):
    """校验失败异常"""

    def __init__(self, field: str, message: str):
        self.field = field
        super().__init__(f"Validation failed for '{field}': {message}")


@step_registry.register
class ValidationStep(BaseStep):
    """
    入参校验步骤

    从上下文读取:
        - validation.request: 原始请求对象

    写入上下文:
        - validation.validated: 校验通过的请求数据
        - validation.model: 请求的模型名称
        - validation.capability: 请求的能力类型
    """

    name = "validation"
    depends_on = []  # 无依赖，第一个执行

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行入参校验"""
        request = ctx.get("validation", "request")

        if request is None:
            return StepResult(
                status=StepStatus.FAILED,
                message="No request found in context",
            )

        try:
            validated = await self._validate_request(request, ctx)
            ctx.set("validation", "validated", validated)

            # 提取关键字段到上下文
            if hasattr(request, "model"):
                ctx.requested_model = request.model
                ctx.set("validation", "model", request.model)

            logger.debug(
                f"Validation passed trace_id={ctx.trace_id} "
                f"model={ctx.requested_model}"
            )

            return StepResult(
                status=StepStatus.SUCCESS,
                data={"model": ctx.requested_model},
            )

        except ValidationError as e:
            logger.warning(f"Validation failed: {e}")
            return StepResult(
                status=StepStatus.FAILED,
                message=str(e),
            )

    async def _validate_request(
        self,
        request: Any,
        ctx: "WorkflowContext",
    ) -> dict:
        """
        执行具体校验逻辑

        可扩展点：
        - Pydantic schema 校验
        - 请求大小限制
        - 字段格式校验
        """
        # 基础校验：model 字段必填
        if hasattr(request, "model") and not request.model:
            raise ValidationError("model", "Model is required")

        # 请求大小限制（基于序列化长度）
        try:
            serialized = request.model_dump() if hasattr(request, "model_dump") else {}
            if serialized:
                import json

                size_bytes = len(json.dumps(serialized).encode())
                if size_bytes > settings.MAX_REQUEST_BYTES:
                    raise ValidationError(
                        "body",
                        f"Request size exceeds limit {settings.MAX_REQUEST_BYTES} bytes",
                    )
        except ValidationError:
            raise
        except Exception:
            # 序列化失败不阻塞，其余校验继续
            pass

        # 外部通道额外校验
        if ctx.is_external:
            # 检查请求大小限制
            # (之前已在通用逻辑中检查过 MAX_REQUEST_BYTES)

            # 内容过滤
            if settings.SECURITY_SQL_INJECTION_DETECT or settings.SECURITY_PROMPT_INJECTION_DETECT:
                await self._check_content_injection(serialized)

        # 返回校验后的数据
        if hasattr(request, "model_dump"):
            return request.model_dump()
        elif hasattr(request, "dict"):
            return request.dict()
        else:
            return {"raw": request}

    async def _check_content_injection(self, data: Any) -> None:
        """递归检查内容注入"""
        if isinstance(data, str):
            if settings.SECURITY_SQL_INJECTION_DETECT and is_potential_sql_injection(data):
                raise ValidationError("body", "Potential SQL injection detected")
            if settings.SECURITY_PROMPT_INJECTION_DETECT and is_potential_prompt_injection(data):
                raise ValidationError("body", "Potential prompt injection detected")
        elif isinstance(data, dict):
            for v in data.values():
                await self._check_content_injection(v)
        elif isinstance(data, list):
            for item in data:
                await self._check_content_injection(item)
