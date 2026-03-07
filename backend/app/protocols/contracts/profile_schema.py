from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.protocols.contracts.contract_versions import (
    PROTOCOL_PROFILE_SCHEMA_VERSION,
    PROVIDER_PROTOCOL_RUNTIME_VERSION,
)
from app.schemas.base import BaseSchema

ProfileCapability = Literal[
    "chat",
    "embedding",
    "image_generation",
    "text_to_speech",
    "speech_to_text",
    "video_generation",
]


class RuntimeHook(BaseSchema):
    name: str
    config: dict[str, Any] = Field(default_factory=dict)


class ProfileTransport(BaseSchema):
    method: str = "POST"
    path: str
    query_template: dict[str, Any] = Field(default_factory=dict)
    header_template: dict[str, Any] = Field(default_factory=dict)


class ProfileRequestConfig(BaseSchema):
    template_engine: str = "openai_compat"
    request_template: dict[str, Any] | str = Field(default_factory=dict)
    request_builder: RuntimeHook | None = None


class ProfileResponseConfig(BaseSchema):
    decoder: RuntimeHook
    response_template: dict[str, Any] = Field(default_factory=dict)
    output_mapping: dict[str, Any] = Field(default_factory=dict)


class ProfileStreamConfig(BaseSchema):
    stream_decoder: RuntimeHook | None = None
    stream_options_mapping: dict[str, Any] = Field(default_factory=dict)


class ProfileErrorConfig(BaseSchema):
    error_decoder: RuntimeHook | None = None


class ProfileAuthConfig(BaseSchema):
    auth_policy: str = "inherit"
    config: dict[str, Any] = Field(default_factory=dict)


class ProfileFeatureFlags(BaseSchema):
    supports_messages: bool = True
    supports_input_items: bool = False
    supports_tools: bool = False
    supports_reasoning: bool = False
    supports_json_mode: bool = False


class ProfileDefaults(BaseSchema):
    headers: dict[str, Any] = Field(default_factory=dict)
    query: dict[str, Any] = Field(default_factory=dict)
    body: dict[str, Any] = Field(default_factory=dict)


class ProtocolProfile(BaseSchema):
    runtime_version: str = PROVIDER_PROTOCOL_RUNTIME_VERSION
    schema_version: str = PROTOCOL_PROFILE_SCHEMA_VERSION
    profile_id: str
    version: int = 1
    provider: str
    protocol_family: str
    capability: ProfileCapability
    transport: ProfileTransport
    request: ProfileRequestConfig
    response: ProfileResponseConfig
    stream: ProfileStreamConfig = Field(default_factory=ProfileStreamConfig)
    errors: ProfileErrorConfig = Field(default_factory=ProfileErrorConfig)
    auth: ProfileAuthConfig = Field(default_factory=ProfileAuthConfig)
    features: ProfileFeatureFlags = Field(default_factory=ProfileFeatureFlags)
    defaults: ProfileDefaults = Field(default_factory=ProfileDefaults)
    metadata: dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "ProfileAuthConfig",
    "ProfileCapability",
    "ProfileDefaults",
    "ProfileErrorConfig",
    "ProfileFeatureFlags",
    "ProfileRequestConfig",
    "ProfileResponseConfig",
    "ProfileStreamConfig",
    "ProfileTransport",
    "ProtocolProfile",
    "RuntimeHook",
]
