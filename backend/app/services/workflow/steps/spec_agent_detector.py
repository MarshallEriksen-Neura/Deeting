"""
SpecAgentDetectorStep: Spec Agent 建议检测步骤

职责:
- 从 AI 响应中提取 <spec_agent_suggestion> 标记
- 解析 JSON 内容
- 将建议信息添加到响应的 meta_info 中
- 从正文中移除标记,保持内容干净
"""

import json
import logging
import re
from typing import TYPE_CHECKING, Any

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)

# 匹配 <spec_agent_suggestion>...</spec_agent_suggestion> 标记
SPEC_AGENT_SUGGESTION_PATTERN = re.compile(
    r'<spec_agent_suggestion>\s*(\{[^}]+\})\s*</spec_agent_suggestion>',
    re.DOTALL | re.IGNORECASE
)


@step_registry.register
class SpecAgentDetectorStep(BaseStep):
    """
    Spec Agent 建议检测步骤
    
    从上下文读取:
        - response_transform.response: 转换后的响应
    
    写入上下文:
        - spec_agent_detector.suggestion: 提取的建议信息 (如果有)
        - spec_agent_detector.cleaned_response: 清理后的响应
    """
    
    name = "spec_agent_detector"
    depends_on = ["response_transform"]
    
    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行 Spec Agent 建议检测"""
        # 仅内部通道启用
        if ctx.is_external:
            return StepResult(status=StepStatus.SUCCESS, message="skip_external")
        
        response = ctx.get("response_transform", "response")
        is_stream = ctx.get("response_transform", "stream", False)
        
        # 流式响应跳过 (流式在客户端处理)
        if is_stream or not response:
            return StepResult(status=StepStatus.SUCCESS, message="skip_stream_or_empty")
        
        try:
            # 提取响应内容
            content = self._extract_content(response)
            if not content:
                return StepResult(status=StepStatus.SUCCESS, message="no_content")
            
            # 检测 spec_agent_suggestion 标记
            match = SPEC_AGENT_SUGGESTION_PATTERN.search(content)
            if not match:
                # 没有建议标记,直接返回
                return StepResult(status=StepStatus.SUCCESS, message="no_suggestion")
            
            # 解析 JSON
            try:
                suggestion_json = match.group(1)
                suggestion = json.loads(suggestion_json)
                
                # 验证必需字段
                if not isinstance(suggestion, dict):
                    raise ValueError("Suggestion must be a dict")
                
                confidence = suggestion.get("confidence", 0)
                if confidence < 0.7:
                    logger.info(
                        f"Spec agent suggestion confidence too low: {confidence}, "
                        f"trace_id={ctx.trace_id}"
                    )
                    # 置信度太低,移除标记但不添加建议
                    cleaned_content = SPEC_AGENT_SUGGESTION_PATTERN.sub('', content).strip()
                    self._update_response_content(ctx, response, cleaned_content)
                    return StepResult(status=StepStatus.SUCCESS, message="low_confidence")
                
                # 从内容中移除标记
                cleaned_content = SPEC_AGENT_SUGGESTION_PATTERN.sub('', content).strip()
                
                # 更新响应内容
                self._update_response_content(ctx, response, cleaned_content)
                
                # 存储建议信息
                ctx.set("spec_agent_detector", "suggestion", suggestion)
                
                logger.info(
                    f"Spec agent suggestion detected trace_id={ctx.trace_id} "
                    f"confidence={confidence}"
                )
                
                return StepResult(
                    status=StepStatus.SUCCESS,
                    data={"has_suggestion": True, "confidence": confidence}
                )
                
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(
                    f"Failed to parse spec_agent_suggestion JSON: {e}, "
                    f"trace_id={ctx.trace_id}"
                )
                # JSON 解析失败,移除标记
                cleaned_content = SPEC_AGENT_SUGGESTION_PATTERN.sub('', content).strip()
                self._update_response_content(ctx, response, cleaned_content)
                return StepResult(status=StepStatus.SUCCESS, message="invalid_json")
        
        except Exception as e:
            logger.error(f"Spec agent detector failed: {e}")
            return StepResult(
                status=StepStatus.SUCCESS,  # 不阻塞流程
                message=f"Detector error: {str(e)}"
            )
    
    def _extract_content(self, response: dict) -> str | None:
        """从响应中提取内容"""
        if not isinstance(response, dict):
            return None
        
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        
        message = choices[0].get("message")
        if not isinstance(message, dict):
            return None
        
        content = message.get("content")
        return content if isinstance(content, str) else None
    
    def _update_response_content(
        self, 
        ctx: "WorkflowContext", 
        response: dict, 
        new_content: str
    ) -> None:
        """更新响应中的内容"""
        if isinstance(response, dict) and "choices" in response:
            choices = response["choices"]
            if isinstance(choices, list) and choices:
                if isinstance(choices[0], dict) and "message" in choices[0]:
                    choices[0]["message"]["content"] = new_content
                    # 更新上下文中的响应
                    ctx.set("response_transform", "response", response)

