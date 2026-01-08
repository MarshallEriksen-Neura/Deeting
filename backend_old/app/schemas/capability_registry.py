from __future__ import annotations

"""
集中定义各能力（chat/embedding/audio/image/video 等）对应的网关内部标准字段。

目的：
- 将能力相关的字段与请求/响应标准化定义放在单一位置，便于元数据/映射规则引用；
- 避免在多个模块重复硬编码字段名，后续扩展（如声音克隆、文生图、视频生成）也复用同一约定。

注意：
- 这里只做“元定义”，不引入业务逻辑；
- 仅引用已有的 Pydantic 请求模型，未定义的能力保持 request_model=None，后续可补充。
"""

from dataclasses import dataclass
from types import MappingProxyType
from typing import Iterable

from pydantic import BaseModel

from app.schemas.audio import SpeechRequest
from app.schemas.image import ImageGenerationRequest
from app.schemas.model import ModelCapability
from app.schemas.video import VideoGenerationRequest


# 版本号：用于验证/迁移 metadata，避免 registry 更新导致老数据误配
SCHEMA_VERSION = "2026-01-04"


def _fields(model_cls: type[BaseModel]) -> tuple[str, ...]:
    """Helper: 获取 Pydantic 模型的字段名元组。"""

    return tuple(model_cls.model_fields.keys())


@dataclass(frozen=True)
class CapabilitySpec:
    """能力层面的标准化定义。"""

    capability: ModelCapability
    request_model: type[BaseModel] | None
    request_fields: tuple[str, ...]
    aliases: tuple[str, ...] = ()
    description: str | None = None


# 统一能力定义表：包含聊天、嵌入、音频（含声音克隆）、文生图、文生视频等。
_CAPABILITY_SPECS: dict[ModelCapability, CapabilitySpec] = {
    ModelCapability.CHAT: CapabilitySpec(
        capability=ModelCapability.CHAT,
        request_model=None,  # 仍沿用 OpenAI /v1/chat/completions 形态，后续补专用模型
        request_fields=(),
        aliases=("chat", "messages", "chat_completions"),
        description="对话生成（OpenAI chat-completions 兼容形态）",
    ),
    ModelCapability.COMPLETION: CapabilitySpec(
        capability=ModelCapability.COMPLETION,
        request_model=None,
        request_fields=(),
        aliases=("completion",),
        description="纯文本补全（OpenAI completions 兼容形态）",
    ),
    ModelCapability.EMBEDDING: CapabilitySpec(
        capability=ModelCapability.EMBEDDING,
        request_model=None,  # 请求字段沿用 OpenAI embeddings（input/model/encoding_format）
        request_fields=(),
        aliases=("embedding", "embeddings"),
        description="文本/向量嵌入",
    ),
    ModelCapability.AUDIO: CapabilitySpec(
        capability=ModelCapability.AUDIO,
        request_model=SpeechRequest,
        request_fields=_fields(SpeechRequest),
        aliases=("tts", "voice", "voice_clone", "speech"),
        description="语音合成/声音克隆，使用 SpeechRequest 统一入参（含 reference_audio_url）",
    ),
    ModelCapability.IMAGE_GENERATION: CapabilitySpec(
        capability=ModelCapability.IMAGE_GENERATION,
        request_model=ImageGenerationRequest,
        request_fields=_fields(ImageGenerationRequest),
        aliases=("image", "text_to_image", "img_gen"),
        description="文生图 / 图像生成（OpenAI images/generations 兼容形态）",
    ),
    ModelCapability.VIDEO_GENERATION: CapabilitySpec(
        capability=ModelCapability.VIDEO_GENERATION,
        request_model=VideoGenerationRequest,
        request_fields=_fields(VideoGenerationRequest),
        aliases=("video", "text_to_video", "vid_gen"),
        description="文生视频 / 图生视频，使用 VideoGenerationRequest 统一入参",
    ),
    ModelCapability.VISION: CapabilitySpec(
        capability=ModelCapability.VISION,
        request_model=None,
        request_fields=(),
        aliases=("vision", "multimodal"),
        description="图文多模态（OpenAI GPT-4o 视觉入参形态，待统一模型）",
    ),
    ModelCapability.FUNCTION_CALLING: CapabilitySpec(
        capability=ModelCapability.FUNCTION_CALLING,
        request_model=None,
        request_fields=(),
        aliases=("tools", "function_calling"),
        description="函数调用/工具调用能力（chat 的子能力，用于映射 tools/functions 字段）",
    ),
}

# 冻结，防止运行时被修改
CAPABILITY_SPECS = MappingProxyType(_CAPABILITY_SPECS)


def list_capabilities() -> list[CapabilitySpec]:
    """返回所有能力定义，按枚举顺序。"""

    return [CAPABILITY_SPECS[c] for c in ModelCapability if c in CAPABILITY_SPECS]


def get_capability_spec(capability: ModelCapability | str) -> CapabilitySpec:
    """按能力枚举或字符串获取定义。"""

    if isinstance(capability, str):
        capability = ModelCapability(capability)
    spec = CAPABILITY_SPECS.get(capability)
    if not spec:
        raise KeyError(f"未知能力: {capability}")
    return spec


def normalize_capability(name: str) -> ModelCapability:
    """
    将任意大小写/别名规范化为 ModelCapability；未知则抛出 KeyError。
    """

    spec = find_by_alias(name)
    if not spec:
        raise KeyError(f"未知能力/别名: {name}")
    return spec.capability


def find_by_alias(name: str) -> CapabilitySpec | None:
    """
    通过别名（如 "voice_clone"、"text_to_image"）查找能力定义。
    返回 None 表示未匹配到。
    """

    lowered = name.strip().lower()
    for spec in CAPABILITY_SPECS.values():
        if lowered == spec.capability.value:
            return spec
        if any(lowered == alias for alias in spec.aliases):
            return spec
    return None


__all__ = [
    "CapabilitySpec",
    "CAPABILITY_SPECS",
    "SCHEMA_VERSION",
    "find_by_alias",
    "get_capability_spec",
    "normalize_capability",
    "list_capabilities",
]
