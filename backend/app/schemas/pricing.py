
from pydantic import Field, model_validator

from .base import BaseSchema


class PricePer1KTokens(BaseSchema):
    input_per_1k: float | None = Field(None, ge=0, description="每 1k 输入 token 单价")
    output_per_1k: float | None = Field(None, ge=0, description="每 1k 输出 token 单价")

    def any_price(self) -> bool:
        return (self.input_per_1k is not None) or (self.output_per_1k is not None)


class ChatPricing(BaseSchema):
    stream: PricePer1KTokens | None = Field(None, description="流式计价")
    non_stream: PricePer1KTokens | None = Field(None, description="非流式计价")
    min_charge: float | None = Field(0, ge=0, description="最小计费额")
    supports_stream: bool = Field(True, description="是否支持流式")
    supports_non_stream: bool = Field(True, description="是否支持非流式")

    @model_validator(mode="after")
    def ensure_price(self):
        if self.stream and self.stream.any_price():
            return self
        if self.non_stream and self.non_stream.any_price():
            return self
        raise ValueError("chat 定价需在 stream 或 non_stream 中提供至少一组单价")


class ImagePricing(BaseSchema):
    per_image: float | None = Field(None, ge=0, description="单张图片固定价格")
    per_megapixel: float | None = Field(None, ge=0, description="按百万像素计价")
    size_multipliers: dict[str, float] | None = Field(
        None, description="尺寸系数，如 {'1024x1024':1, '1792x1024':1.5}"
    )

    @model_validator(mode="after")
    def ensure_price(self):
        if self.per_image is not None or self.per_megapixel is not None:
            return self
        raise ValueError("image 定价需提供 per_image 或 per_megapixel 之一")


class AudioPricing(BaseSchema):
    tts_per_1k_chars: float | None = Field(None, ge=0, description="TTS 每 1000 字符单价")
    stt_per_minute: float | None = Field(None, ge=0, description="STT 每分钟单价")
    stt_per_second: float | None = Field(None, ge=0, description="STT 每秒单价（优先于每分钟）")

    @model_validator(mode="after")
    def ensure_price(self):
        if any(
            v is not None
            for v in (self.tts_per_1k_chars, self.stt_per_minute, self.stt_per_second)
        ):
            return self
        raise ValueError("audio 定价需提供 tts_per_1k_chars 或 stt_per_minute/stt_per_second")


class VideoPricing(BaseSchema):
    per_second: float | None = Field(None, ge=0, description="视频生成/处理每秒单价")
    per_clip: float | None = Field(None, ge=0, description="单段视频固定价")
    resolution_multipliers: dict[str, float] | None = Field(
        None, description="分辨率倍率，如 {'1080p':1.2,'4k':2}"
    )
    aspect_ratio_multipliers: dict[str, float] | None = Field(
        None, description="纵横比倍率，如 {'9:16':1.1}"
    )

    @model_validator(mode="after")
    def ensure_price(self):
        if self.per_second is not None or self.per_clip is not None:
            return self
        raise ValueError("video 定价需提供 per_second 或 per_clip")


class PricingConfig(BaseSchema):
    """
    计费配置：按 capability 细分，mode=bypass 时允许为空。
    """

    mode: str = Field("charge", description="charge | bypass")
    currency: str = Field("CNY", max_length=8, description="币种")

    chat: ChatPricing | None = None
    image: ImagePricing | None = None
    audio: AudioPricing | None = None
    video: VideoPricing | None = None

    @model_validator(mode="after")
    def check_mode_and_capability(self):
        if self.mode == "bypass":
            return self

        # 具体 capability 的校验由外部结合 capability 使用
        return self

    def ensure_capability_pricing(self, capability: str):
        """
        在外部调用，确保与 capability 匹配的定价已配置。
        """
        if self.mode == "bypass":
            return

        match capability:
            case "chat":
                if not self.chat:
                    raise ValueError("capability=chat 需提供 chat 定价配置")
            case "image" | "image_generation":
                if not self.image:
                    raise ValueError("capability=image_generation（或 image）需提供 image 定价配置")
            case "audio" | "text_to_speech" | "speech_to_text":
                if not self.audio:
                    raise ValueError("capability=audio/text_to_speech/speech_to_text 需提供 audio 定价配置")
            case "video" | "video_generation":
                if not self.video:
                    raise ValueError("capability=video/video_generation 需提供 video 定价配置")
            case _:
                # 其他能力保持向后兼容，不强制
                return


class RetryConfig(BaseSchema):
    max_retries: int = Field(3, ge=0, description="最大重试次数")
    backoff_seconds: float = Field(0.5, ge=0, description="重试退避基数秒")
    backoff_multiplier: float = Field(2.0, ge=1, description="退避倍率")


class LimitConfig(BaseSchema):
    rpm: int | None = Field(None, ge=1, description="每分钟请求上限")
    tpm: int | None = Field(None, ge=1, description="每分钟 token 上限")
    timeout_seconds: int | None = Field(None, ge=1, description="超时秒数")
    concurrency: int | None = Field(None, ge=1, description="并发上限")
    retry: RetryConfig = Field(default_factory=RetryConfig, description="重试配置")

    # 多模态容量限制
    max_image_pixels: int | None = Field(None, ge=1, description="图片像素上限")
    max_audio_seconds: int | None = Field(None, ge=1, description="音频时长上限")
    max_video_seconds: int | None = Field(None, ge=1, description="视频时长上限")
