"""
Tests for request_transformer and response_adapter with CapabilityConfig.

验证使用 CapabilityConfig 的新方法 transform_with_config() 和 adapt_with_config()。
"""

import pytest
from pydantic import BaseModel

from app.schemas.capability_registry import ModelCapability
from app.services.provider.capability_resolver import CapabilityConfig
from app.services.provider.request_transformer import RequestTransformer
from app.services.provider.response_adapter import ResponseAdapter


# =============================================================================
# Test Fixtures
# =============================================================================


class SampleRequest(BaseModel):
    """测试用请求模型。"""

    model: str
    input: str
    voice: str | None = None
    speed: float | None = None


# =============================================================================
# RequestTransformer Tests
# =============================================================================


class TestRequestTransformerWithConfig:
    """RequestTransformer.transform_with_config 测试。"""

    def test_no_transform(self):
        """无 request_map 时直接返回原始数据。"""
        config = CapabilityConfig(capability=ModelCapability.EMBEDDING)
        transformer = RequestTransformer()

        request = SampleRequest(model="text-embedding-3-small", input="hello")
        result = transformer.transform_with_config(request, config)

        assert result == {"model": "text-embedding-3-small", "input": "hello"}

    def test_with_request_map(self):
        """有 request_map 时应用映射。"""
        config = CapabilityConfig(
            capability=ModelCapability.AUDIO,
            request_map={
                "voice_id": "voice",
                "speed_factor": "speed",
            },
        )
        transformer = RequestTransformer()

        request = SampleRequest(
            model="tts-1",
            input="hello",
            voice="alloy",
            speed=1.5,
        )
        result = transformer.transform_with_config(request, config)

        assert result == {"voice_id": "alloy", "speed_factor": 1.5}

    def test_with_defaults(self):
        """应用 defaults 不覆盖已有值。"""
        config = CapabilityConfig(
            capability=ModelCapability.AUDIO,
            defaults={"speed": 1.0, "format": "mp3"},
        )
        transformer = RequestTransformer()

        request = SampleRequest(
            model="tts-1",
            input="hello",
            voice="alloy",
            speed=1.5,  # 已有值，不应被覆盖
        )
        result = transformer.transform_with_config(request, config)

        assert result["speed"] == 1.5  # 保持原值
        assert result["format"] == "mp3"  # 应用默认值

    def test_with_dict_input(self):
        """接受字典输入。"""
        config = CapabilityConfig(
            capability=ModelCapability.EMBEDDING,
            request_map={"text": "input"},
        )
        transformer = RequestTransformer()

        result = transformer.transform_with_config(
            {"model": "ada", "input": "test text"},
            config,
        )

        assert result == {"text": "test text"}

    def test_jmespath_nested_access(self):
        """JMESPath 嵌套访问。"""
        config = CapabilityConfig(
            capability=ModelCapability.CHAT,
            request_map={
                "custom_field": "extra.nested.value",
            },
        )
        transformer = RequestTransformer()

        result = transformer.transform_with_config(
            {"extra": {"nested": {"value": "found"}}},
            config,
        )

        assert result == {"custom_field": "found"}


class TestRequestTransformerDict:
    """RequestTransformer.transform_dict 测试。"""

    def test_basic_transform(self):
        """基本字典转换。"""
        transformer = RequestTransformer()

        result = transformer.transform_dict(
            {"model": "gpt-4", "messages": [{"role": "user", "content": "hi"}]},
            input_map={"prompt": "messages[0].content"},
        )

        assert result == {"prompt": "hi"}

    def test_with_defaults(self):
        """带默认值的转换。"""
        transformer = RequestTransformer()

        result = transformer.transform_dict(
            {"input": "hello"},
            defaults={"encoding_format": "float"},
        )

        assert result == {"input": "hello", "encoding_format": "float"}


# =============================================================================
# ResponseAdapter Tests
# =============================================================================


class TestResponseAdapterWithConfig:
    """ResponseAdapter.adapt_with_config 测试。"""

    def test_no_transform(self):
        """无 response_map 时原样返回。"""
        config = CapabilityConfig(capability=ModelCapability.EMBEDDING)
        adapter = ResponseAdapter()

        response = {"data": [{"embedding": [0.1, 0.2]}]}
        result = adapter.adapt_with_config(response, config)

        assert result == response

    def test_with_response_map(self):
        """有 response_map 时应用映射。"""
        config = CapabilityConfig(
            capability=ModelCapability.AUDIO,
            response_map={
                "audio_url": "data.url",
                "duration": "data.duration_seconds",
            },
        )
        adapter = ResponseAdapter()

        response = {
            "data": {
                "url": "https://example.com/audio.mp3",
                "duration_seconds": 10.5,
            }
        }
        result = adapter.adapt_with_config(response, config)

        assert result == {
            "audio_url": "https://example.com/audio.mp3",
            "duration": 10.5,
        }

    def test_bytes_passthrough(self):
        """bytes 类型直接透传。"""
        config = CapabilityConfig(
            capability=ModelCapability.AUDIO,
            response_map={"url": "data.url"},
        )
        adapter = ResponseAdapter()

        response = b"audio binary data"
        result = adapter.adapt_with_config(response, config)

        assert result == response

    def test_list_response(self):
        """列表响应的 JMESPath 访问。"""
        config = CapabilityConfig(
            capability=ModelCapability.EMBEDDING,
            response_map={
                "first_embedding": "[0].embedding",
                "model": "[0].model",
            },
        )
        adapter = ResponseAdapter()

        response = [
            {"embedding": [0.1, 0.2, 0.3], "model": "text-embedding-3-small"},
            {"embedding": [0.4, 0.5, 0.6], "model": "text-embedding-3-small"},
        ]
        result = adapter.adapt_with_config(response, config)

        assert result == {
            "first_embedding": [0.1, 0.2, 0.3],
            "model": "text-embedding-3-small",
        }

    def test_literal_value_in_map(self):
        """映射中的字面值。"""
        config = CapabilityConfig(
            capability=ModelCapability.CHAT,
            response_map={
                "provider": "custom_provider",  # 这是 JMESPath 表达式
                "version": 1,  # 这是字面值
            },
        )
        adapter = ResponseAdapter()

        response = {"custom_provider": "openai", "other": "data"}
        result = adapter.adapt_with_config(response, config)

        assert result["provider"] == "openai"
        assert result["version"] == 1


# =============================================================================
# Integration Tests
# =============================================================================


class TestTransformAdaptIntegration:
    """请求转换 + 响应适配集成测试。"""

    def test_embedding_flow(self):
        """Embedding 能力端到端流程。"""
        # 模拟 embedding 能力配置
        config = CapabilityConfig(
            capability=ModelCapability.EMBEDDING,
            endpoint="/v1/embeddings",
            request_map={
                "text": "input",
                "model_name": "model",
            },
            response_map={
                "embeddings": "data[*].embedding",
                "usage_tokens": "usage.total_tokens",
            },
        )

        transformer = RequestTransformer()
        adapter = ResponseAdapter()

        # 请求转换
        request_body = transformer.transform_with_config(
            {"model": "text-embedding-3-small", "input": "Hello world"},
            config,
        )
        assert request_body == {
            "text": "Hello world",
            "model_name": "text-embedding-3-small",
        }

        # 响应适配
        provider_response = {
            "data": [{"embedding": [0.1, 0.2, 0.3]}],
            "usage": {"total_tokens": 5},
        }
        adapted = adapter.adapt_with_config(provider_response, config)
        assert adapted == {
            "embeddings": [[0.1, 0.2, 0.3]],
            "usage_tokens": 5,
        }
