from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.protocols.contracts.contract_versions import CANONICAL_SCHEMA_VERSION
from app.schemas.base import BaseSchema

Capability = Literal[
    "chat",
    "embedding",
    "image_generation",
    "text_to_speech",
    "speech_to_text",
    "video_generation",
]

CanonicalStreamEventType = Literal[
    "response_started",
    "message_started",
    "text_delta",
    "reasoning_delta",
    "tool_call_started",
    "tool_call_delta",
    "tool_call_finished",
    "usage",
    "message_finished",
    "response_finished",
    "error",
]


class CanonicalToolFunction(BaseSchema):
    name: str
    description: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class CanonicalToolDefinition(BaseSchema):
    type: str = "function"
    function: CanonicalToolFunction


class CanonicalToolCall(BaseSchema):
    id: str | None = None
    type: str = "function"
    name: str | None = None
    arguments: str | dict[str, Any] | None = None
    status: str | None = None


class CanonicalUsage(BaseSchema):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cached_tokens: int = 0


class CanonicalContentBlock(BaseSchema):
    type: str = "text"
    text: str | None = None
    mime_type: str | None = None
    url: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class CanonicalMessage(BaseSchema):
    role: str
    content: str | list[CanonicalContentBlock] | None = None
    reasoning: str | None = None
    tool_calls: list[CanonicalToolCall] = Field(default_factory=list)
    tool_call_id: str | None = None
    name: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CanonicalInputItem(BaseSchema):
    type: str
    role: str | None = None
    text: str | None = None
    mime_type: str | None = None
    url: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class CanonicalOutputFormat(BaseSchema):
    type: str = "text"
    json_schema: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


class CanonicalClientContext(BaseSchema):
    channel: str = "internal"
    request_id: str | None = None
    session_id: str | None = None
    trace_id: str | None = None
    assistant_id: UUID | None = None
    tenant_id: str | None = None
    user_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CanonicalRequest(BaseSchema):
    canonical_version: str = CANONICAL_SCHEMA_VERSION
    capability: Capability = "chat"
    model: str
    provider_model_id: str | None = None
    instructions: str | None = None
    messages: list[CanonicalMessage] = Field(default_factory=list)
    input_items: list[CanonicalInputItem] = Field(default_factory=list)
    tools: list[CanonicalToolDefinition] = Field(default_factory=list)
    tool_choice: str | dict[str, Any] | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    stream: bool = False
    output_format: CanonicalOutputFormat | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    extensions: dict[str, Any] = Field(default_factory=dict)
    client_context: CanonicalClientContext = Field(default_factory=CanonicalClientContext)


class CanonicalResponse(BaseSchema):
    canonical_version: str = CANONICAL_SCHEMA_VERSION
    model: str
    output_text: str | None = None
    content_blocks: list[CanonicalContentBlock] = Field(default_factory=list)
    tool_calls: list[CanonicalToolCall] = Field(default_factory=list)
    reasoning: str | None = None
    finish_reason: str | None = None
    usage: CanonicalUsage = Field(default_factory=CanonicalUsage)
    provider_metadata: dict[str, Any] = Field(default_factory=dict)
    raw_response: dict[str, Any] = Field(default_factory=dict)


class CanonicalStreamEvent(BaseSchema):
    canonical_version: str = CANONICAL_SCHEMA_VERSION
    type: CanonicalStreamEventType
    sequence: int = 0
    model: str | None = None
    delta_text: str | None = None
    reasoning_delta: str | None = None
    tool_call_delta: CanonicalToolCall | None = None
    usage_delta: CanonicalUsage | None = None
    finish_reason: str | None = None
    provider_metadata: dict[str, Any] = Field(default_factory=dict)
    raw_event: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


__all__ = [
    "Capability",
    "CanonicalClientContext",
    "CanonicalContentBlock",
    "CanonicalInputItem",
    "CanonicalMessage",
    "CanonicalOutputFormat",
    "CanonicalRequest",
    "CanonicalResponse",
    "CanonicalStreamEvent",
    "CanonicalStreamEventType",
    "CanonicalToolCall",
    "CanonicalToolDefinition",
    "CanonicalToolFunction",
    "CanonicalUsage",
]
