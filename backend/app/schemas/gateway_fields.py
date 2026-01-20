from typing import Any

from pydantic import Field

from .base import BaseSchema

# 网关统一字段版本，便于审计/兼容
GATEWAY_FIELDS_VERSION = "2026-01-20"

# 通用字段（各能力共享）
COMMON_FIELDS: set[str] = {
    "provider",
    "capability",
    "model",
    "request_id",
    "stream",
    "messages",
    "system",
    "tools",
    "tool_choice",
    "max_tokens",
    "temperature",
    "top_p",
    "top_k",
    "stop",
    "stop_sequences",
    "presence_penalty",
    "frequency_penalty",
    "seed",
    "safety_settings",
    "user_identifier",
    "safety_identifier",
    # 计费挂钩
    "pricing_mode",
    "input_tokens",
    "output_tokens",
    "media_tokens",
    "currency",
}

# 能力专属字段
CHAT_FIELDS: set[str] = COMMON_FIELDS | {
    "response_format",
    "modalities",
    "audio.voice",
    "audio.format",
    "audio.speed",
}

IMAGE_ONLY_FIELDS: set[str] = {
    "image.size",
    "image.quality",
    "image.format",
    "image.background",
    "image.output_compression",
}

AUDIO_ONLY_FIELDS: set[str] = {
    "audio.voice",
    "audio.format",
    "audio.speed",
}

VIDEO_ONLY_FIELDS: set[str] = {
    "video.aspect_ratio",
    "video.resolution",
    "video.duration_seconds",
    "video.reference_images",
    "video.negative_prompt",
    "video.person_generation",
}

ALLOWED_FIELDS_BY_CAPABILITY: dict[str, set[str]] = {
    "chat": CHAT_FIELDS,
    "image": COMMON_FIELDS | IMAGE_ONLY_FIELDS,
    "image_generation": COMMON_FIELDS | IMAGE_ONLY_FIELDS,
    "text_to_speech": COMMON_FIELDS | AUDIO_ONLY_FIELDS,
    "speech_to_text": COMMON_FIELDS | AUDIO_ONLY_FIELDS,
    "audio": COMMON_FIELDS | AUDIO_ONLY_FIELDS,
    "video_generation": COMMON_FIELDS | VIDEO_ONLY_FIELDS,
    "video": COMMON_FIELDS | VIDEO_ONLY_FIELDS,
}


def allowed_fields_for(capability: str) -> set[str]:
    """
    返回某能力允许的统一字段集合（未知能力返回 COMMON_FIELDS）。
    """
    return ALLOWED_FIELDS_BY_CAPABILITY.get(capability, COMMON_FIELDS)


class ImageOptions(BaseSchema):
    size: str | None = Field(None, description="输出尺寸，如 1024x1024 或 auto")
    quality: str | None = Field(None, description="输出质量/风格")
    format: str | None = Field(None, description="返回格式，例 png/webp/base64")
    background: str | None = Field(None, description="背景处理，例 transparent")
    output_compression: str | None = Field(None, description="是否压缩输出")


class AudioOptions(BaseSchema):
    voice: str | None = Field(None, description="音色/角色标识")
    format: str | None = Field(None, description="音频格式 mp3/opus/aac/flac/wav/pcm 等")
    speed: float | None = Field(None, description="朗读速度倍数")


class VideoOptions(BaseSchema):
    aspect_ratio: str | None = Field(None, description="纵横比，如 16:9 / 9:16 / 1:1")
    resolution: str | None = Field(None, description="分辨率标识，如 720p/1080p")
    duration_seconds: int | None = Field(None, description="目标时长（秒）")
    reference_images: list[str] | None = Field(None, description="参考图像 URL/base64 列表")
    negative_prompt: str | None = Field(None, description="反向提示词")
    person_generation: str | None = Field(None, description="人物生成开关/模式")


class GatewayRequestFields(BaseSchema):
    """
    网关内部统一的多模态请求字段（供路由/模板映射使用）。
    """

    capability: str = Field(
        ...,
        description="能力：chat / image_generation / text_to_speech / speech_to_text / video_generation",
    )
    model: str | None = Field(None, description="逻辑/统一模型 ID")
    provider: str | None = Field(None, description="上游厂商标识（便于审计）")
    request_id: str | None = Field(None, description="幂等键")
    stream: bool = Field(False, description="是否流式返回")

    # 通用生成控制
    messages: list[Any] | None = Field(None, description="对话消息/多模态内容")
    system: Any | None = Field(None, description="系统提示词")
    tools: list[dict[str, Any]] | None = Field(None, description="工具定义")
    tool_choice: Any | None = Field(None, description="工具选择策略")
    max_tokens: int | None = Field(None, description="最大输出 token")
    temperature: float | None = Field(None, description="采样温度")
    top_p: float | None = Field(None, description="核采样 p")
    top_k: int | None = Field(None, description="k 采样")
    stop: list[str] | None = Field(None, description="停止序列（兼容单字段 stop）")
    stop_sequences: list[str] | None = Field(None, description="停止序列（Gemini/Claude 风格）")
    presence_penalty: float | None = Field(None, description="存在惩罚")
    frequency_penalty: float | None = Field(None, description="频率惩罚")
    seed: int | None = Field(None, description="随机种子")
    safety_settings: list[dict[str, Any]] | None = Field(None, description="安全/风控配置")
    user_identifier: str | None = Field(None, description="用户标识（内容安全）")
    safety_identifier: str | None = Field(None, description="安全审计 ID")
    response_format: Any | None = Field(None, description="输出格式，兼容 JSON schema 等")
    modalities: list[str] | None = Field(None, description="输出模态列表，例如 ['text','image']")

    # 媒体专属
    image: ImageOptions | None = Field(None, description="图像生成参数")
    audio: AudioOptions | None = Field(None, description="音频生成/返回参数")
    video: VideoOptions | None = Field(None, description="视频生成参数")

    # 计费相关（由网关侧填充）
    pricing_mode: str | None = Field(None, description="charge | bypass")
    input_tokens: int | None = Field(None, description="输入 token 数")
    output_tokens: int | None = Field(None, description="输出 token 数")
    media_tokens: int | None = Field(None, description="媒体/帧计量")
    currency: str | None = Field(None, description="币种，默认跟随计费模板")
