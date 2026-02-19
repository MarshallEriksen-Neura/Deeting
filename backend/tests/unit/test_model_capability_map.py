from app.constants.model_capability_map import (
    expand_capabilities,
    guess_capabilities,
    normalize_capabilities,
    primary_capability,
)


def test_guess_capabilities_image_models():
    assert guess_capabilities("gpt-image-1") == ["image_generation"]
    assert guess_capabilities("dall-e-3") == ["image_generation"]
    assert guess_capabilities("flux.1-dev") == ["image_generation"]
    assert guess_capabilities("qwen-image-2512") == ["image_generation"]


def test_guess_capabilities_vision_chat_models():
    caps = guess_capabilities("gpt-4-vision-preview")
    assert caps == ["chat"]


def test_primary_capability():
    assert primary_capability(["chat", "image_generation"]) == "chat"
    assert primary_capability(["image_generation"]) == "image_generation"


def test_normalize_capabilities_aliases():
    assert normalize_capabilities(["video", "VIDEO_GENERATION"]) == ["video_generation"]
    assert normalize_capabilities(["audio"]) == ["speech_to_text"]
    assert normalize_capabilities(["tts"]) == ["text_to_speech"]


def test_expand_capabilities_supports_aliases():
    expanded = expand_capabilities("video_generation")
    assert "video_generation" in expanded
    assert "video" in expanded
    assert "text_to_video" in expanded
