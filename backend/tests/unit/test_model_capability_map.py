from app.constants.model_capability_map import guess_capabilities, primary_capability


def test_guess_capabilities_image_models():
    assert guess_capabilities("gpt-image-1") == ["image"]
    assert guess_capabilities("dall-e-3") == ["image"]
    assert guess_capabilities("flux.1-dev") == ["image"]
    assert guess_capabilities("qwen-image-2512") == ["image"]


def test_guess_capabilities_vision_chat_models():
    caps = guess_capabilities("gpt-4-vision-preview")
    assert caps[0] == "chat"
    assert "vision" in caps


def test_primary_capability():
    assert primary_capability(["chat", "vision"]) == "chat"
    assert primary_capability(["image"]) == "image"
