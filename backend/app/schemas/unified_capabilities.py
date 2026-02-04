from typing import Any

from pydantic import BaseModel, Field


# ==========================================
# 1. Text to Image (生图 - Pro Standard)
# ==========================================
class ImageGenerationRequest(BaseModel):
    """
    Unified Standard for Text-to-Image Generation.
    Covers OpenAI DALL-E 3, Stability AI, Midjourney, etc.
    """

    # Core
    prompt: str = Field(..., description="Main text prompt")
    negative_prompt: str | None = Field(
        None, description="Negative prompt (what to avoid)"
    )

    # Dimensions (Explicit width/height OR aspect_ratio)
    width: int | None = Field(1024, description="Image width")
    height: int | None = Field(1024, description="Image height")
    aspect_ratio: str | None = Field(
        None,
        description="Aspect ratio (e.g. '16:9'). Overrides width/height for providers like MJ/DALL-E 3.",
    )

    # Generation Control
    num_outputs: int = Field(1, description="Number of images to generate (n)")
    steps: int | None = Field(30, description="Inference steps (Stability/SD)")
    cfg_scale: float | None = Field(7.0, description="Guidance scale (CFG)")
    seed: int | None = Field(None, description="Random seed for reproducibility")
    sampler_name: str | None = Field(
        None, description="Sampler (e.g., 'Euler a', 'DPM++ 2M Karras')"
    )

    # Quality & Style (DALL-E 3 / MJ)
    quality: str | None = Field(
        "standard", description="Quality: 'standard' or 'hd'"
    )
    style: str | None = Field("natural", description="Style: 'vivid' or 'natural'")

    # Advanced / Vendor Specific
    # Using a dict allows flexible expansion for Loras, ControlNet, etc. without breaking schema
    extra_params: dict[str, Any] | None = Field(
        default_factory=dict, description="Vendor specific extra parameters"
    )

    response_format: str = Field(
        "url", description="Output format: 'url' or 'b64_json'"
    )


class ImageGenerationResponse(BaseModel):
    images: list[dict[str, Any]] = Field(
        ...,
        description="List of results. Item: {'url': '...', 'b64_json': '...', 'seed': 123}",
    )
    timings: dict[str, float] | None = None


# ==========================================
# 2. Text to Speech (TTS - Pro Standard)
# ==========================================
class TTSRequest(BaseModel):
    """
    Unified Standard for Text-to-Speech.
    Covers OpenAI, ElevenLabs, Azure, etc.
    """

    input: str = Field(..., description="Text to speak")
    voice: str = Field(..., description="Voice ID or Name")
    model: str | None = Field(
        None, description="Specific model ID (e.g. 'eleven_multilingual_v2')"
    )

    # Audio Control
    speed: float = Field(1.0, description="Speech speed (0.5 - 2.0)")
    pitch: float | None = Field(None, description="Voice pitch adjustment")
    volume: float | None = Field(None, description="Volume adjustment")

    # Emotion / Stability (ElevenLabs style)
    stability: float | None = Field(None, description="Voice stability (0.0-1.0)")
    similarity_boost: float | None = Field(
        None, description="Clarity/Similarity boost (0.0-1.0)"
    )
    style_exaggeration: float | None = Field(
        None, description="Style exaggeration (0.0-1.0)"
    )

    response_format: str = Field(
        "mp3", description="Output format (mp3, wav, pcm, opus)"
    )


class TTSResponse(BaseModel):
    audio_content: str = Field(..., description="Base64 encoded audio data")
    content_type: str = Field("audio/mpeg", description="MIME type")
    duration_seconds: float | None = None


# ==========================================
# 3. Speech to Text (STT / ASR)
# ==========================================
class STTRequest(BaseModel):
    audio_data: str = Field(..., description="Base64 encoded audio or URL")
    language: str | None = Field(
        None, description="ISO language code (auto-detect if None)"
    )
    prompt: str | None = Field(
        None, description="Context prompt to guide transcription"
    )
    temperature: float | None = Field(0.0, description="Sampling temperature")
    response_format: str = Field("json", description="json, text, srt, vtt")
    timestamp_granularities: list[str] | None = Field(
        None, description="['word', 'segment']"
    )


class STTResponse(BaseModel):
    text: str = Field(..., description="Transcribed text")
    segments: list[dict] | None = Field(
        None, description="Detailed segments with timestamps"
    )


# ==========================================
# 4. Video Generation (Text/Image to Video)
# ==========================================
class VideoGenerationRequest(BaseModel):
    """
    Unified Standard for Video Generation.
    Covers Stability Video, Runway, Sora, Haiper.
    """

    prompt: str = Field(..., description="Text description of the video")
    image_url: str | None = Field(
        None, description="Source image for Image-to-Video"
    )

    # Dimensions
    width: int | None = Field(None, description="Video width")
    height: int | None = Field(None, description="Video height")

    # Time
    duration_seconds: int | None = Field(
        None, description="Target duration in seconds"
    )
    fps: int | None = Field(None, description="Frames per second")

    # Motion Control
    motion_bucket_id: int | None = Field(
        127, description="Motion intensity (1-255) for SVD"
    )
    noise_aug_strength: float | None = Field(
        0.1, description="Noise augmentation strength (0.0-1.0)"
    )
    seed: int | None = Field(None, description="Random seed")


class VideoGenerationResponse(BaseModel):
    video_url: str = Field(..., description="URL to the generated video")
    cover_image_url: str | None = None


# ==========================================
# Capability Registry
# ==========================================
CAPABILITY_MAP = {
    "image_generation": (ImageGenerationRequest, ImageGenerationResponse),
    "text_to_speech": (TTSRequest, TTSResponse),
    "speech_to_text": (STTRequest, STTResponse),
    "video_generation": (VideoGenerationRequest, VideoGenerationResponse),
    "chat": (None, None),  # Handled by ChatCompletionRequest
}
