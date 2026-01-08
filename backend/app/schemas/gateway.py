"""
Gateway 请求/响应 Schema

职责：
- 定义网关 API 的请求和响应格式
- 兼容 OpenAI API 格式
- 支持扩展字段

包含 Schema：

1. ChatCompletionRequest
   - model: 模型名称
   - messages: 消息列表
   - stream: 是否流式
   - temperature, max_tokens, etc.

2. ChatCompletionResponse
   - id: 响应 ID
   - object: "chat.completion"
   - choices: 选项列表
   - usage: Token 用量

3. EmbeddingsRequest
   - model: 模型名称
   - input: 输入文本

4. EmbeddingsResponse
   - data: 嵌入向量列表
   - usage: Token 用量

5. ModelListResponse
   - data: 模型列表

6. GatewayError
   - code: 错误码
   - message: 错误信息
   - source: 错误来源 (gateway/upstream/client)
   - trace_id: 追踪 ID

7. StreamChunk (SSE)
   - 流式响应的单个块
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str = Field(..., description="消息角色: system/user/assistant/tool")
    content: str | list | None = Field(default=None, description="消息内容")
    tool_calls: list | None = Field(default=None, description="工具调用列表")
    tool_call_id: str | None = Field(default=None, description="工具调用 ID (role=tool)")


class ChatCompletionRequest(BaseModel):
    model: str = Field(..., description="目标模型")
    messages: list[ChatMessage] = Field(default_factory=list)
    stream: bool = Field(default=False)
    temperature: float | None = None
    max_tokens: int | None = None
    session_id: str | None = Field(
        default=None, description="会话 ID（可选，不传则自动生成）"
    )


# ===== 兼容性入口 Schema =====


class AnthropicContentBlock(BaseModel):
    type: str = Field(default="text")
    text: str | None = None


class AnthropicMessage(BaseModel):
    role: str
    content: str | list[AnthropicContentBlock] | list[str]


class AnthropicMessagesRequest(BaseModel):
    model: str
    messages: list[AnthropicMessage]
    system: str | None = None
    max_tokens: int | None = Field(default=None, description="输出上限 token 数")
    temperature: float | None = None
    stream: bool = False


class ResponsesRequest(BaseModel):
    model: str
    input: str | list | dict
    system: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    stream: bool = False


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatChoice(BaseModel):
    index: int
    message: ChatMessage
    finish_reason: str | None = None


class ChatCompletionResponse(BaseModel):
    id: str = ""
    object: str = "chat.completion"
    model: str = ""
    choices: list[ChatChoice] = Field(default_factory=list)
    usage: UsageInfo | None = None
    session_id: str | None = None


class EmbeddingsRequest(BaseModel):
    model: str
    input: str | list[str]


class EmbeddingItem(BaseModel):
    object: str = "embedding"
    index: int
    embedding: list[float]


class EmbeddingsResponse(BaseModel):
    data: list[EmbeddingItem]
    model: str
    usage: UsageInfo | None = None


class ModelInfo(BaseModel):
    id: str
    object: str = "model"
    owned_by: str = "system"


class ModelListResponse(BaseModel):
    data: list[ModelInfo]


class GatewayError(BaseModel):
    code: str
    message: str
    source: str | None = None
    trace_id: str | None = None
    upstream_status: int | None = None
    upstream_code: str | None = None


class StreamChunk(BaseModel):
    data: str
