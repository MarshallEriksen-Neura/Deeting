"""
SemanticKernelInjectionStep: 语义内核注入步骤

职责：
- 基于检索到的工具集动态选择 Persona
- 检索相关记忆并注入 Prompt
- 更新 enhanced_prompt 供后续步骤使用

位置：在 AssistantPromptInjection 和 McpDiscovery 之后

设计原则：
- Fail-open: 任何失败不阻断主流程
- 会话级 Persona 锁定保证一致性
- 支持 Bandit 优化
"""

import logging
from typing import TYPE_CHECKING

from app.core.config import settings
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


def _is_semantic_kernel_enabled() -> bool:
    """检查语义内核功能是否启用"""
    return bool(getattr(settings, "SEMANTIC_KERNEL_ENABLED", True))


@step_registry.register
class SemanticKernelInjectionStep(BaseStep):
    """
    语义内核注入步骤

    从上下文读取：
    - validation.request.messages (用户意图)
    - assistant.enhanced_prompt (基础 Prompt)
    - mcp_discovery.tools (已检索的工具)

    写入上下文：
    - semantic_kernel.persona_id
    - semantic_kernel.persona_name
    - semantic_kernel.injected_memories
    - semantic_kernel.metadata
    - assistant.enhanced_prompt (更新为组装后的 Prompt)
    """

    name = "semantic_kernel_injection"
    depends_on = ["validation", "mcp_discovery", "assistant_prompt_injection"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行语义内核注入"""
        # 仅内部通道启用
        if ctx.is_external:
            return StepResult(status=StepStatus.SUCCESS, message="skip_external")

        # 检查功能开关
        if not _is_semantic_kernel_enabled():
            logger.debug("SemanticKernelInjectionStep: disabled by config")
            return StepResult(status=StepStatus.SUCCESS, message="disabled")

        # 提取用户意图
        query = self._extract_user_query(ctx)
        if not query:
            logger.debug("SemanticKernelInjectionStep: no query, skipping")
            return StepResult(status=StepStatus.SUCCESS, message="no_query")

        # 获取已检索的工具
        tools = ctx.get("mcp_discovery", "tools") or []
        if not tools:
            logger.debug("SemanticKernelInjectionStep: no tools, skipping")
            return StepResult(status=StepStatus.SUCCESS, message="no_tools")

        # 获取基础 Prompt
        base_prompt = ctx.get("assistant", "enhanced_prompt")

        # 组装动态 Prompt
        try:
            from app.services.semantic_kernel import semantic_kernel_service

            result = await semantic_kernel_service().assemble_prompt(
                query=query,
                tools=tools,
                user_id=ctx.user_id,
                session_id=ctx.trace_id,  # 使用 trace_id 作为会话标识
                base_prompt=base_prompt,
                db_session=ctx.db_session,
            )

            # 存储结果到上下文
            ctx.set("semantic_kernel", "persona_id", result.persona_id)
            ctx.set("semantic_kernel", "persona_name", result.persona_name)
            ctx.set("semantic_kernel", "injected_memories", result.injected_memory_ids)
            ctx.set("semantic_kernel", "assembly_duration_ms", result.assembly_duration_ms)
            ctx.set("semantic_kernel", "metadata", result.assembly_metadata)

            # 更新 enhanced_prompt 供后续步骤使用
            ctx.set("assistant", "enhanced_prompt", result.final_prompt)

            # 发送状态事件
            ctx.emit_status(
                stage="semantic_kernel",
                step=self.name,
                state="success",
                code="prompt_assembled",
                meta={
                    "persona_id": result.persona_id,
                    "persona_name": result.persona_name,
                    "memory_count": len(result.injected_memory_ids),
                    "duration_ms": round(result.assembly_duration_ms, 2),
                },
            )

            logger.info(
                "SemanticKernelInjectionStep: success trace_id=%s persona=%s memories=%d duration_ms=%.2f",
                ctx.trace_id,
                result.persona_id,
                len(result.injected_memory_ids),
                result.assembly_duration_ms,
            )

            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "persona_id": result.persona_id,
                    "persona_name": result.persona_name,
                    "memory_count": len(result.injected_memory_ids),
                },
            )

        except Exception as e:
            # Fail-open: 记录日志但不阻断流程
            logger.warning(
                "SemanticKernelInjectionStep: failed trace_id=%s error=%s",
                ctx.trace_id,
                str(e),
                exc_info=True,
            )

            ctx.emit_status(
                stage="semantic_kernel",
                step=self.name,
                state="degraded",
                code="assembly_failed",
                meta={"error": str(e)},
            )

            return StepResult(
                status=StepStatus.DEGRADED,
                message=f"fail_open: {e!s}",
            )

    def _extract_user_query(self, ctx: "WorkflowContext") -> str:
        """
        提取用户最新消息作为查询

        优先从 validation.request.messages 获取
        """
        request = ctx.get("validation", "request")
        if not request:
            return ""

        messages = getattr(request, "messages", None)
        if not messages:
            return ""

        # 倒序查找最新的用户消息
        for msg in reversed(list(messages)):
            if isinstance(msg, dict) and msg.get("role") == "user":
                content = msg.get("content")
                if isinstance(content, str):
                    return content.strip()
                # 处理多模态消息 (content 为列表)
                if isinstance(content, list):
                    text_parts = []
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            text_parts.append(part.get("text", ""))
                    return " ".join(text_parts).strip()

        return ""
