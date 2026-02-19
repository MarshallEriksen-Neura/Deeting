"""Tests for request_builders module."""

from app.core.provider.request_builders import (
    apply_request_builder,
    ark_content_array_builder,
)


class TestArkContentArrayBuilder:
    """Tests for ark_content_array_builder."""

    def test_text_to_video_basic(self):
        """纯文生视频：只有 prompt，无 flags"""
        request_data = {"model": "doubao-seedance-1-5-pro-251215", "prompt": "一只猫在草地上奔跑"}
        config = {"type": "ark_content_array", "prompt_flags": {}}

        result = ark_content_array_builder(request_data, config)

        assert result["model"] == "doubao-seedance-1-5-pro-251215"
        assert len(result["content"]) == 1
        assert result["content"][0]["type"] == "text"
        assert result["content"][0]["text"] == "一只猫在草地上奔跑"

    def test_text_to_video_with_flags(self):
        """文生视频 + flags 拼接"""
        request_data = {
            "model": "doubao-seedance-2-0-260128",
            "prompt": "城市夜景",
            "aspect_ratio": "16:9",
            "duration": 5,
            "fps": 24,
            "seed": 42,
        }
        config = {
            "type": "ark_content_array",
            "prompt_flags": {
                "aspect_ratio": "--ratio",
                "duration": "--dur",
                "fps": "--fps",
                "seed": "--seed",
            },
        }

        result = ark_content_array_builder(request_data, config)

        text = result["content"][0]["text"]
        assert text.startswith("城市夜景")
        assert "--ratio 16:9" in text
        assert "--dur 5" in text
        assert "--fps 24" in text
        assert "--seed 42" in text

    def test_image_to_video(self):
        """图生视频：带 image_url"""
        request_data = {
            "model": "doubao-seedance-1-5-pro-251215",
            "prompt": "让图片动起来",
            "image_url": "https://example.com/img.jpg",
            "duration": 5,
        }
        config = {
            "type": "ark_content_array",
            "prompt_flags": {"duration": "--dur"},
            "image_field": "image_url",
            "image_content_type": "image_url",
        }

        result = ark_content_array_builder(request_data, config)

        assert len(result["content"]) == 2
        assert result["content"][0]["type"] == "text"
        assert "--dur 5" in result["content"][0]["text"]
        assert result["content"][1]["type"] == "image_url"
        assert result["content"][1]["image_url"]["url"] == "https://example.com/img.jpg"

    def test_no_image_url_skips_image_item(self):
        """无 image_url 时不追加 image 条目"""
        request_data = {"model": "test-model", "prompt": "hello"}
        config = {
            "type": "ark_content_array",
            "prompt_flags": {},
            "image_field": "image_url",
        }

        result = ark_content_array_builder(request_data, config)
        assert len(result["content"]) == 1

    def test_none_flag_values_skipped(self):
        """None 值的 flag 参数不拼接"""
        request_data = {
            "model": "test-model",
            "prompt": "hello",
            "aspect_ratio": None,
            "duration": 5,
        }
        config = {
            "type": "ark_content_array",
            "prompt_flags": {"aspect_ratio": "--ratio", "duration": "--dur"},
        }

        result = ark_content_array_builder(request_data, config)
        text = result["content"][0]["text"]
        assert "--ratio" not in text
        assert "--dur 5" in text


class TestApplyRequestBuilder:
    """Tests for apply_request_builder dispatch."""

    def test_empty_config_returns_original(self):
        """空 config 原样返回"""
        data = {"prompt": "hello", "model": "test"}
        result = apply_request_builder({}, data)
        assert result is data

    def test_no_type_returns_original(self):
        """无 type 字段原样返回"""
        data = {"prompt": "hello"}
        result = apply_request_builder({"prompt_flags": {}}, data)
        assert result is data

    def test_unknown_type_returns_original(self):
        """未知 type 原样返回"""
        data = {"prompt": "hello"}
        result = apply_request_builder({"type": "nonexistent_builder"}, data)
        assert result is data

    def test_known_type_dispatches(self):
        """已注册的 type 正确调度"""
        data = {"model": "m", "prompt": "p"}
        result = apply_request_builder(
            {"type": "ark_content_array", "prompt_flags": {}}, data
        )
        assert "content" in result
        assert result["model"] == "m"
