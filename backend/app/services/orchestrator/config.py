"""
编排配置：定义内外通道的编排模板

支持从 DB/JSON 加载配置，实现配置驱动的编排流程。
"""

from dataclasses import dataclass, field
from enum import Enum

from app.services.orchestrator.context import Channel
from app.services.workflow.steps.base import StepConfig


class WorkflowTemplate(str, Enum):
    """预定义的编排模板"""

    EXTERNAL_CHAT = "external_chat"  # 外部 Chat 完整流程
    EXTERNAL_EMBEDDINGS = "external_embeddings"  # 外部 Embeddings
    EXTERNAL_IMAGE = "external_image" # 外部 Image (Config Driven)
    INTERNAL_CHAT = "internal_chat"  # 内部 Chat 简化流程
    INTERNAL_IMAGE = "internal_image" # 内部 Image (Config Driven)
    INTERNAL_DEBUG = "internal_debug"  # 内部调试模式
    INTERNAL_PREVIEW = "internal_preview"  # 内部助手体验（无会话落库）


@dataclass
class WorkflowConfig:
    """编排配置"""

    template: WorkflowTemplate
    steps: list[str]  # 步骤名称列表（按执行顺序）
    step_configs: dict[str, StepConfig] = field(default_factory=dict)
    enabled: bool = True
    version: str = "1.0"


# ===== 预定义编排模板 =====

EXTERNAL_CHAT_WORKFLOW = WorkflowConfig(
    template=WorkflowTemplate.EXTERNAL_CHAT,
    steps=[
        "request_adapter",  # 0) 入口格式适配（OpenAI/Claude/Responses 等）
        "validation",  # 1) 入参校验
        "signature_verify",  # 1.5) 外部签名校验
        "resolve_assets",  # 2) 资源引用解析（asset:// -> signed URL）
        "mcp_discovery", # 2.5) MCP 工具发现 (User BYOP)
        "quota_check",  # 3) 配额/额度检查（外部）
        "rate_limit",  # 4) 限流
        "routing",  # 5) 路由决策
        "template_render",  # 6) 模板渲染
        "agent_executor",  # 7) 执行与工具循环 (原 upstream_call)
        "response_transform",  # 8) 响应转换
        "memory_write",  # 9) 记忆写入（外部，异步）
        "sanitize",  # 10) 脱敏（外部）
        "billing",  # 11) 计费
        "audit_log",  # 12) 审计日志
    ],
    step_configs={
        "quota_check": StepConfig(timeout=5.0),
        "rate_limit": StepConfig(timeout=2.0),
        "routing": StepConfig(timeout=10.0, max_retries=1),
        "agent_executor": StepConfig(timeout=120.0, max_retries=2, retry_delay=1.0),
        "billing": StepConfig(timeout=10.0, max_retries=3),
    },
)

# New Config-Driven Workflow for Image Generation
EXTERNAL_IMAGE_WORKFLOW = WorkflowConfig(
    template=WorkflowTemplate.EXTERNAL_IMAGE,
    steps=[
        "request_adapter",
        "validation",
        "signature_verify",
        "resolve_assets",
        "quota_check",
        "rate_limit",
        "routing",
        "provider_execution", # New Step
        "response_transform",
        "sanitize", # Maybe?
        "billing",
        "audit_log",
    ],
    step_configs={
        "quota_check": StepConfig(timeout=5.0),
        "rate_limit": StepConfig(timeout=2.0),
        "routing": StepConfig(timeout=10.0, max_retries=1),
        "provider_execution": StepConfig(timeout=300.0, max_retries=1), # Longer timeout for image gen
        "billing": StepConfig(timeout=10.0, max_retries=3),
    },
)

INTERNAL_CHAT_WORKFLOW = WorkflowConfig(
    template=WorkflowTemplate.INTERNAL_CHAT,
    steps=[
        "validation",  # 1) 入参校验
        "conversation_load",  # 2) 会话上下文加载
        "assistant_prompt_injection",  # 2.5) 助手提示词注入 (Spec Agent 能力)
        "resolve_assets",  # 3) 资源引用解析（asset:// -> signed URL）
        "mcp_discovery", # 3.5) MCP 工具发现 (User BYOP)
        "quota_check",  # 4) 配额/余额检查（与外部一致）
        "rate_limit",  # 5) 限流
        "routing",  # 6) 路由决策
        "template_render",  # 7) 模板渲染
        "agent_executor",  # 8) 执行与工具循环 (原 upstream_call)
        "response_transform",  # 9) 响应转换
        "spec_agent_detector",  # 9.5) Spec Agent 建议检测
        "conversation_append",  # 10) 写入窗口 & 触发摘要
        "memory_write",  # 11) 记忆写入（内部跳过）
        "sanitize",  # 12) 脱敏
        "billing",  # 13) 计费记录
        "audit_log",  # 14) 审计日志（内部）
    ],
    step_configs={
        "quota_check": StepConfig(timeout=5.0),
        "rate_limit": StepConfig(timeout=2.0),
        "routing": StepConfig(timeout=10.0),
        "agent_executor": StepConfig(timeout=180.0, max_retries=2),  # 内部超时更长
        "billing": StepConfig(timeout=10.0, max_retries=3),
    },
)

INTERNAL_IMAGE_WORKFLOW = WorkflowConfig(
    template=WorkflowTemplate.INTERNAL_IMAGE,
    steps=[
        "validation",
        "resolve_assets", # Maybe internal tasks need assets?
        "quota_check",
        "rate_limit",
        "routing",
        "provider_execution", # New Step
        "response_transform",
        "billing",
        "audit_log",
    ],
    step_configs={
        "quota_check": StepConfig(timeout=5.0),
        "rate_limit": StepConfig(timeout=2.0),
        "routing": StepConfig(timeout=10.0),
        "provider_execution": StepConfig(timeout=600.0, max_retries=1), # Very long timeout for internal tasks
        "billing": StepConfig(timeout=10.0, max_retries=3),
    }
)

INTERNAL_PREVIEW_WORKFLOW = WorkflowConfig(
    template=WorkflowTemplate.INTERNAL_PREVIEW,
    steps=[
        "validation",  # 1) 入参校验
        "resolve_assets",  # 2) 资源引用解析（asset:// -> signed URL）
        "mcp_discovery", # 2.5) MCP 工具发现 (User BYOP)
        "quota_check",  # 3) 配额/余额检查（与内部一致）
        "rate_limit",  # 4) 限流
        "routing",  # 5) 路由决策
        "template_render",  # 6) 模板渲染
        "agent_executor",  # 7) 执行与工具循环 (原 upstream_call)
        "response_transform",  # 8) 响应转换
        "sanitize",  # 9) 脱敏
        "billing",  # 10) 计费记录
        "audit_log",  # 11) 审计日志（内部）
    ],
    step_configs=dict(INTERNAL_CHAT_WORKFLOW.step_configs),
)

INTERNAL_DEBUG_WORKFLOW = WorkflowConfig(
    template=WorkflowTemplate.INTERNAL_DEBUG,
    steps=[
        "validation",
        "routing",
    ],
    step_configs={
        "routing": StepConfig(timeout=10.0),
    },
)

# 模板注册表
WORKFLOW_TEMPLATES: dict[WorkflowTemplate, WorkflowConfig] = {
    WorkflowTemplate.EXTERNAL_CHAT: EXTERNAL_CHAT_WORKFLOW,
    WorkflowTemplate.EXTERNAL_IMAGE: EXTERNAL_IMAGE_WORKFLOW,
    WorkflowTemplate.INTERNAL_CHAT: INTERNAL_CHAT_WORKFLOW,
    WorkflowTemplate.INTERNAL_IMAGE: INTERNAL_IMAGE_WORKFLOW,
    WorkflowTemplate.INTERNAL_PREVIEW: INTERNAL_PREVIEW_WORKFLOW,
    WorkflowTemplate.INTERNAL_DEBUG: INTERNAL_DEBUG_WORKFLOW,
}


def get_workflow_for_channel(
    channel: Channel,
    capability: str = "chat",
) -> WorkflowConfig:
    """
    根据通道和能力获取编排配置

    Args:
        channel: 通道类型
        capability: 能力类型 (chat, embedding, image_generation, etc.)

    Returns:
        对应的编排配置
    """
    capability = capability.lower()
    media_capabilities = {
        "image_generation",
        "text_to_speech",
        "speech_to_text",
        "video_generation",
    }
    
    if channel == Channel.EXTERNAL:
        if capability == "embedding":
            return WORKFLOW_TEMPLATES.get(
                WorkflowTemplate.EXTERNAL_EMBEDDINGS,
                EXTERNAL_CHAT_WORKFLOW,
            )
        if capability in media_capabilities:
            return EXTERNAL_IMAGE_WORKFLOW
        return EXTERNAL_CHAT_WORKFLOW
    else:
        # Internal
        if capability in media_capabilities:
            return INTERNAL_IMAGE_WORKFLOW
        if capability != "chat":
            return INTERNAL_PREVIEW_WORKFLOW
        return INTERNAL_CHAT_WORKFLOW
