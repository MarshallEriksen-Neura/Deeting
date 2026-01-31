"""
AssistantPromptInjectionStep: 助手提示词注入与增强步骤

职责:
- 根据 assistant_id 加载助手的 system_prompt
- 注入 Spec Agent 模式切换能力
- 让模型自主判断是否需要切换到任务规划模式
"""

import logging
from typing import TYPE_CHECKING
from uuid import UUID

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)

# Spec Agent 模式切换能力注入模板
SPEC_AGENT_CAPABILITY_INJECTION = """

---

**🔧 高级能力: 任务规划模式 (Spec Agent)**

当用户的需求符合以下特征时,你应该建议切换到「任务规划模式」:

✅ **适合切换的场景**:
- 多步骤任务 (需要"先...然后...最后...")
- 条件分支逻辑 (包含"如果...那么...否则...")
- 需要多个工具协同 (搜索 + 计算 + 比较 + 通知)
- 持续监控/定时任务 (价格监控、定时提醒)
- 复杂决策流程 (需要根据中间结果调整后续步骤)

❌ **不适合切换的场景**:
- 简单问答 (查询信息、解释概念)
- 单步骤任务 (只需调用一个工具)
- 闲聊对话

**如何建议切换**:

当你判断用户需求适合任务规划模式时 (confidence >= 0.7),请在回复的**最后**添加以下特殊标记:

<spec_agent_suggestion>
{
  "confidence": 0.85,
  "reasoning": "用户需求包含价格监控、条件下单和通知提醒,涉及多步骤和条件分支",
  "trigger_factors": ["多步骤", "条件分支", "持续监控"],
  "user_message": "我注意到你的需求可能涉及多个步骤和条件判断。我可以为你生成一个详细的执行计划,自动化完成整个流程。是否切换到「任务规划模式」?"
}
</spec_agent_suggestion>

**重要规则**:
- 只在确实需要时才建议切换 (confidence >= 0.7)
- 必须在正常回复的**最后**添加 <spec_agent_suggestion> 标记
- 标记内必须是有效的 JSON 格式
- 仍然要给出正常的文字回复,不要只输出标记
- user_message 字段是向用户展示的提示文案,要友好且清晰
"""


@step_registry.register
class AssistantPromptInjectionStep(BaseStep):
    """
    助手提示词注入步骤
    
    从上下文读取:
        - validation.request: 原始请求
        - validation.validated: 校验后的请求数据
    
    写入上下文:
        - assistant.id: 助手 ID
        - assistant.system_prompt: 原始 system prompt
        - assistant.enhanced_prompt: 增强后的 system prompt (注入 Spec Agent 能力)
    """
    
    name = "assistant_prompt_injection"
    depends_on = ["validation", "conversation_load"]
    
    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行助手提示词注入"""
        # 仅内部通道启用
        if ctx.is_external:
            return StepResult(status=StepStatus.SUCCESS, message="skip_external")
        
        request = ctx.get("validation", "request")
        if not request:
            return StepResult(status=StepStatus.FAILED, message="No request found")
        
        assistant_id = getattr(request, "assistant_id", None)
        
        # 如果没有指定 assistant_id,跳过
        if not assistant_id:
            logger.debug(f"No assistant_id provided, skipping prompt injection trace_id={ctx.trace_id}")
            return StepResult(status=StepStatus.SUCCESS, message="no_assistant_id")
        
        # 加载助手信息
        try:
            assistant_prompt, assistant_name = await self._load_assistant_prompt_info(ctx, assistant_id)
            if not assistant_prompt:
                logger.warning(f"Assistant {assistant_id} not found, skipping injection")
                return StepResult(status=StepStatus.SUCCESS, message="assistant_not_found")
            
            # 注入 Spec Agent 能力
            enhanced_prompt = self._inject_spec_agent_capability(assistant_prompt)
            
            # 存储到上下文
            ctx.set("assistant", "id", str(assistant_id))
            ctx.set("assistant", "name", assistant_name)
            ctx.set("assistant", "system_prompt", assistant_prompt)
            ctx.set("assistant", "enhanced_prompt", enhanced_prompt)

            ctx.emit_status(
                stage="remember",
                step=self.name,
                state="success",
                code="assistant.selected",
                meta={
                    "assistant_id": str(assistant_id),
                    "assistant_name": assistant_name,
                },
            )
            
            logger.info(
                f"Assistant prompt injected trace_id={ctx.trace_id} "
                f"assistant_id={assistant_id}"
            )
            
            return StepResult(
                status=StepStatus.SUCCESS,
                data={"assistant_id": str(assistant_id)}
            )
            
        except Exception as e:
            logger.error(f"Failed to inject assistant prompt: {e}")
            return StepResult(
                status=StepStatus.FAILED,
                message=f"Prompt injection failed: {str(e)}"
            )
    
    async def _load_assistant_prompt_info(
        self, ctx: "WorkflowContext", assistant_id: UUID
    ) -> tuple[str | None, str | None]:
        """加载助手的 system_prompt 与名称"""
        from app.models.assistant import Assistant, AssistantVersion
        from sqlalchemy import select

        # 查询助手及其当前版本
        stmt = (
            select(AssistantVersion.system_prompt, AssistantVersion.name)
            .join(Assistant, Assistant.current_version_id == AssistantVersion.id)
            .where(Assistant.id == assistant_id)
        )

        result = await ctx.db_session.execute(stmt)
        row = result.first()
        if not row:
            return None, None
        return row[0], row[1]
    
    def _inject_spec_agent_capability(self, original_prompt: str) -> str:
        """注入 Spec Agent 模式切换能力"""
        # 在原始 prompt 后追加能力说明
        return original_prompt.strip() + "\n" + SPEC_AGENT_CAPABILITY_INJECTION
