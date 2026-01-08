"""
Tests for capability_resolver module.

验证 CapabilityConfig 结构化配置解析和 resolve_capability_config 函数。
"""

import pytest

from app.schemas.capability_registry import ModelCapability
from app.services.provider.capability_resolver import (
    CapabilityConfig,
    get_default_endpoint,
    list_provider_capabilities,
    resolve_capability,
    resolve_capability_config,
)


class TestCapabilityConfig:
    """CapabilityConfig 数据类测试。"""

    def test_default_values(self):
        """测试默认值。"""
        config = CapabilityConfig(capability=ModelCapability.CHAT)
        assert config.capability == ModelCapability.CHAT
        assert config.endpoint == ""
        assert config.method == "POST"
        assert config.request_map == {}
        assert config.response_map == {}
        assert config.headers == {}
        assert config.query_params == {}
        assert config.defaults == {}
        assert config.adapter is None
        assert config.version == "v1"

    def test_has_request_transform(self):
        """测试 has_request_transform 方法。"""
        # 无转换
        config = CapabilityConfig(capability=ModelCapability.CHAT)
        assert not config.has_request_transform()

        # 有 request_map
        config = CapabilityConfig(
            capability=ModelCapability.CHAT,
            request_map={"voice_id": "voice"},
        )
        assert config.has_request_transform()

        # 有 defaults
        config = CapabilityConfig(
            capability=ModelCapability.CHAT,
            defaults={"temperature": 0.7},
        )
        assert config.has_request_transform()

    def test_has_response_transform(self):
        """测试 has_response_transform 方法。"""
        # 无转换
        config = CapabilityConfig(capability=ModelCapability.CHAT)
        assert not config.has_response_transform()

        # 有 response_map
        config = CapabilityConfig(
            capability=ModelCapability.AUDIO,
            response_map={"audio_url": "data.url"},
        )
        assert config.has_response_transform()

    def test_uses_sdk_adapter(self):
        """测试 uses_sdk_adapter 方法。"""
        # 无适配器（走 HTTP）
        config = CapabilityConfig(capability=ModelCapability.CHAT)
        assert not config.uses_sdk_adapter()

        # 有适配器
        config = CapabilityConfig(
            capability=ModelCapability.CHAT,
            adapter="openai_sdk",
        )
        assert config.uses_sdk_adapter()

    def test_frozen(self):
        """测试 frozen 属性（不可变）。"""
        config = CapabilityConfig(capability=ModelCapability.CHAT)
        with pytest.raises(AttributeError):
            config.endpoint = "/new/path"  # type: ignore


class TestResolveCapability:
    """resolve_capability 函数测试（向后兼容）。"""

    def test_no_metadata(self):
        """无 metadata 时返回 None。"""
        result = resolve_capability(
            provider_meta=None,
            capability="chat",
        )
        assert result is None

    def test_empty_capabilities(self):
        """空 capabilities 时返回 None。"""
        result = resolve_capability(
            provider_meta={"capabilities": {}},
            capability="chat",
        )
        assert result is None

    def test_basic_capability(self):
        """基本能力配置解析。"""
        provider_meta = {
            "capabilities": {
                "chat": {
                    "endpoint": "/v1/chat/completions",
                    "request_map": {"model": "model"},
                }
            }
        }
        result = resolve_capability(
            provider_meta=provider_meta,
            capability="chat",
        )
        assert result is not None
        assert result["endpoint"] == "/v1/chat/completions"
        assert result["request_map"] == {"model": "model"}

    def test_capability_alias(self):
        """能力别名解析。"""
        provider_meta = {
            "capabilities": {
                "embedding": {
                    "endpoint": "/v1/embeddings",
                }
            }
        }
        # 使用别名 "embeddings"
        result = resolve_capability(
            provider_meta=provider_meta,
            capability="embeddings",
        )
        assert result is not None
        assert result["endpoint"] == "/v1/embeddings"

    def test_model_override(self):
        """模型级覆盖。"""
        provider_meta = {
            "capabilities": {
                "audio": {
                    "endpoint": "/v1/audio/speech",
                    "request_map": {"voice": "voice"},
                }
            }
        }
        model_meta = {
            "_override_capabilities": {
                "audio": {
                    "endpoint": "/v1/tts/custom",  # 覆盖端点
                }
            }
        }
        result = resolve_capability(
            provider_meta=provider_meta,
            model_meta=model_meta,
            capability="audio",
        )
        assert result is not None
        assert result["endpoint"] == "/v1/tts/custom"  # 覆盖生效
        assert result["request_map"] == {"voice": "voice"}  # 基础配置保留


class TestResolveCapabilityConfig:
    """resolve_capability_config 函数测试。"""

    def test_no_metadata_with_default_endpoint(self):
        """无 metadata 但有默认端点时返回默认配置。"""
        config = resolve_capability_config(
            provider_meta=None,
            capability="chat",
        )
        assert config is not None
        assert config.capability == ModelCapability.CHAT
        assert config.endpoint == "/v1/chat/completions"
        assert config.method == "POST"

    def test_no_metadata_no_default_endpoint(self):
        """无 metadata 且无默认端点时返回 None。"""
        config = resolve_capability_config(
            provider_meta=None,
            capability="unknown_capability_xyz",
        )
        assert config is None

    def test_full_config(self):
        """完整配置解析。"""
        provider_meta = {
            "capabilities": {
                "audio": {
                    "endpoint": "/v1/audio/speech",
                    "method": "POST",
                    "request_map": {"voice_id": "voice", "speed_factor": "speed"},
                    "response_map": {"audio_url": "data.url"},
                    "headers": {"X-Custom-Header": "value"},
                    "query_params": {"format": "mp3"},
                    "defaults": {"speed": 1.0},
                    "adapter": None,
                    "version": "v2",
                }
            }
        }
        config = resolve_capability_config(
            provider_meta=provider_meta,
            capability="audio",
        )
        assert config is not None
        assert config.capability == ModelCapability.AUDIO
        assert config.endpoint == "/v1/audio/speech"
        assert config.method == "POST"
        assert config.request_map == {"voice_id": "voice", "speed_factor": "speed"}
        assert config.response_map == {"audio_url": "data.url"}
        assert config.headers == {"X-Custom-Header": "value"}
        assert config.query_params == {"format": "mp3"}
        assert config.defaults == {"speed": 1.0}
        assert config.adapter is None
        assert config.version == "v2"

    def test_base_url_concatenation(self):
        """base_url 拼接。"""
        provider_meta = {
            "capabilities": {
                "embedding": {
                    "endpoint": "/v1/embeddings",
                }
            }
        }
        config = resolve_capability_config(
            provider_meta=provider_meta,
            capability="embedding",
            base_url="https://api.example.com",
        )
        assert config is not None
        assert config.endpoint == "https://api.example.com/v1/embeddings"

    def test_base_url_with_trailing_slash(self):
        """base_url 尾部斜杠处理。"""
        provider_meta = {
            "capabilities": {
                "chat": {
                    "endpoint": "v1/chat/completions",  # 无前导斜杠
                }
            }
        }
        config = resolve_capability_config(
            provider_meta=provider_meta,
            capability="chat",
            base_url="https://api.example.com/",  # 有尾部斜杠
        )
        assert config is not None
        assert config.endpoint == "https://api.example.com/v1/chat/completions"

    def test_absolute_url_not_modified(self):
        """绝对 URL 不被修改。"""
        provider_meta = {
            "capabilities": {
                "chat": {
                    "endpoint": "https://custom.api.com/v1/chat",
                }
            }
        }
        config = resolve_capability_config(
            provider_meta=provider_meta,
            capability="chat",
            base_url="https://api.example.com",
        )
        assert config is not None
        assert config.endpoint == "https://custom.api.com/v1/chat"

    def test_model_override_in_config(self):
        """模型级覆盖在 CapabilityConfig 中生效。"""
        provider_meta = {
            "capabilities": {
                "image_generation": {
                    "endpoint": "/v1/images/generations",
                    "defaults": {"size": "1024x1024"},
                }
            }
        }
        model_meta = {
            "_override_capabilities": {
                "image_generation": {
                    "defaults": {"size": "512x512"},  # 覆盖 defaults
                }
            }
        }
        config = resolve_capability_config(
            provider_meta=provider_meta,
            model_meta=model_meta,
            capability="image_generation",
        )
        assert config is not None
        assert config.defaults == {"size": "512x512"}

    def test_adapter_field(self):
        """adapter 字段解析。"""
        provider_meta = {
            "capabilities": {
                "chat": {
                    "endpoint": "/v1/chat/completions",
                    "adapter": "openai_sdk",
                }
            }
        }
        config = resolve_capability_config(
            provider_meta=provider_meta,
            capability="chat",
        )
        assert config is not None
        assert config.adapter == "openai_sdk"
        assert config.uses_sdk_adapter()


class TestListProviderCapabilities:
    """list_provider_capabilities 函数测试。"""

    def test_no_metadata(self):
        """无 metadata 返回空列表。"""
        result = list_provider_capabilities(None)
        assert result == []

    def test_with_capabilities(self):
        """有 capabilities 返回 key 列表。"""
        provider_meta = {
            "capabilities": {
                "chat": {},
                "embedding": {},
                "audio": {},
            }
        }
        result = list_provider_capabilities(provider_meta)
        assert set(result) == {"chat", "embedding", "audio"}


class TestGetDefaultEndpoint:
    """get_default_endpoint 函数测试。"""

    def test_known_capabilities(self):
        """已知能力返回默认端点。"""
        assert get_default_endpoint("chat") == "/v1/chat/completions"
        assert get_default_endpoint("embedding") == "/v1/embeddings"
        assert get_default_endpoint("audio") == "/v1/audio/speech"
        assert get_default_endpoint("image_generation") == "/v1/images/generations"

    def test_unknown_capability(self):
        """未知能力返回 None。"""
        assert get_default_endpoint("unknown_xyz") is None

    def test_alias_resolution(self):
        """别名解析。"""
        assert get_default_endpoint("tts") == "/v1/audio/speech"
        assert get_default_endpoint("embeddings") == "/v1/embeddings"
