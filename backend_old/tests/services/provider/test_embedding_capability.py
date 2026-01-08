"""
Embedding 能力端到端集成测试。

验证使用 CapabilityConfig 驱动的 embedding 调用流程。
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from uuid import uuid4
import httpx

from app.schemas.capability_registry import ModelCapability
from app.services.provider.capability_resolver import (
    CapabilityConfig,
    resolve_capability_config,
)
from app.services.provider.capability_client import (
    CapabilityClient,
    CapabilityClientError,
)
from app.services.embedding_service import embed_text
from app.auth import AuthenticatedAPIKey


class TestEmbeddingCapabilityConfig:
    """Embedding 能力配置测试。"""

    def test_default_endpoint(self):
        """无 metadata 时使用默认 embedding 端点。"""
        config = resolve_capability_config(
            provider_meta=None,
            capability="embedding",
        )
        assert config is not None
        assert config.capability == ModelCapability.EMBEDDING
        assert config.endpoint == "/v1/embeddings"
        assert config.method == "POST"

    def test_custom_endpoint(self):
        """自定义 embedding 端点。"""
        provider_meta = {
            "capabilities": {
                "embedding": {
                    "endpoint": "/api/embed",
                    "request_map": {"text": "input"},
                }
            }
        }
        config = resolve_capability_config(
            provider_meta=provider_meta,
            capability="embedding",
            base_url="https://custom.api.com",
        )
        assert config is not None
        assert config.endpoint == "https://custom.api.com/api/embed"
        assert config.request_map == {"text": "input"}

    def test_alias_embeddings(self):
        """使用 'embeddings' 别名。"""
        config = resolve_capability_config(
            provider_meta=None,
            capability="embeddings",  # 别名
        )
        assert config is not None
        assert config.capability == ModelCapability.EMBEDDING


class TestEmbeddingCapabilityClient:
    """Embedding 能力客户端测试。"""

    @pytest.mark.asyncio
    async def test_call_with_transform(self):
        """带请求转换的调用。"""
        config = CapabilityConfig(
            capability=ModelCapability.EMBEDDING,
            endpoint="https://api.example.com/v1/embeddings",
            request_map={
                "text": "input",
                "model_name": "model",
            },
            response_map={
                "vector": "data[0].embedding",
            },
        )

        # Mock httpx response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [{"embedding": [0.1, 0.2, 0.3]}],
            "usage": {"total_tokens": 5},
        }

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.request.return_value = mock_response
            mock_instance.__aenter__.return_value = mock_instance
            mock_instance.__aexit__.return_value = None
            mock_client.return_value = mock_instance

            client = CapabilityClient()
            result = await client.call(
                config=config,
                request={"model": "text-embedding-3-small", "input": "hello world"},
                headers={"Authorization": "Bearer test-key"},
            )

            # 验证请求转换
            call_args = mock_instance.request.call_args
            assert call_args.kwargs["json"] == {
                "text": "hello world",
                "model_name": "text-embedding-3-small",
            }
            assert call_args.kwargs["headers"]["Authorization"] == "Bearer test-key"

            # 验证响应适配
            assert result == {"vector": [0.1, 0.2, 0.3]}

    @pytest.mark.asyncio
    async def test_call_passthrough(self):
        """无转换的直通调用。"""
        config = CapabilityConfig(
            capability=ModelCapability.EMBEDDING,
            endpoint="https://api.openai.com/v1/embeddings",
            # 无 request_map 和 response_map
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [{"embedding": [0.1, 0.2]}],
            "model": "text-embedding-3-small",
        }

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.request.return_value = mock_response
            mock_instance.__aenter__.return_value = mock_instance
            mock_instance.__aexit__.return_value = None
            mock_client.return_value = mock_instance

            client = CapabilityClient()
            result = await client.call(
                config=config,
                request={"model": "text-embedding-3-small", "input": "test"},
            )

            # 请求原样传递
            call_args = mock_instance.request.call_args
            assert call_args.kwargs["json"] == {
                "model": "text-embedding-3-small",
                "input": "test",
            }

            # 响应原样返回
            assert result == {
                "data": [{"embedding": [0.1, 0.2]}],
                "model": "text-embedding-3-small",
            }

    @pytest.mark.asyncio
    async def test_call_with_defaults(self):
        """应用默认值。"""
        config = CapabilityConfig(
            capability=ModelCapability.EMBEDDING,
            endpoint="https://api.example.com/embed",
            defaults={"encoding_format": "float"},
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"embedding": [0.1]}

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.request.return_value = mock_response
            mock_instance.__aenter__.return_value = mock_instance
            mock_instance.__aexit__.return_value = None
            mock_client.return_value = mock_instance

            client = CapabilityClient()
            await client.call(
                config=config,
                request={"model": "ada", "input": "test"},
            )

            call_args = mock_instance.request.call_args
            # 默认值已应用
            assert call_args.kwargs["json"]["encoding_format"] == "float"

    @pytest.mark.asyncio
    async def test_error_handling(self):
        """错误处理。"""
        config = CapabilityConfig(
            capability=ModelCapability.EMBEDDING,
            endpoint="https://api.example.com/embed",
        )

        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.json.return_value = {"error": "Invalid API key"}

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.request.return_value = mock_response
            mock_instance.__aenter__.return_value = mock_instance
            mock_instance.__aexit__.return_value = None
            mock_client.return_value = mock_instance

            client = CapabilityClient()
            with pytest.raises(CapabilityClientError) as exc_info:
                await client.call(
                    config=config,
                    request={"input": "test"},
                )

            assert exc_info.value.status_code == 401
            assert exc_info.value.response_body == {"error": "Invalid API key"}

    @pytest.mark.asyncio
    async def test_missing_endpoint(self):
        """缺少 endpoint 时报错。"""
        config = CapabilityConfig(
            capability=ModelCapability.EMBEDDING,
            endpoint="",  # 空 endpoint
        )

        client = CapabilityClient()
        with pytest.raises(CapabilityClientError) as exc_info:
            await client.call(config=config, request={"input": "test"})

        assert "缺少 endpoint" in str(exc_info.value)


class TestEmbeddingE2EFlow:
    """Embedding 端到端流程测试。"""

    @pytest.mark.asyncio
    async def test_full_flow_openai_compatible(self):
        """OpenAI 兼容的完整流程。"""
        # 1. 构建 provider metadata（模拟 OpenAI 配置）
        provider_meta = {
            "capabilities": {
                "embedding": {
                    "endpoint": "/v1/embeddings",
                    # OpenAI 兼容，无需映射
                }
            }
        }

        # 2. 解析能力配置
        config = resolve_capability_config(
            provider_meta=provider_meta,
            capability="embedding",
            base_url="https://api.openai.com",
        )
        assert config is not None
        assert config.endpoint == "https://api.openai.com/v1/embeddings"

        # 3. 模拟调用
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "object": "list",
            "data": [
                {"object": "embedding", "embedding": [0.1, 0.2, 0.3], "index": 0}
            ],
            "model": "text-embedding-3-small",
            "usage": {"prompt_tokens": 5, "total_tokens": 5},
        }

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.request.return_value = mock_response
            mock_instance.__aenter__.return_value = mock_instance
            mock_instance.__aexit__.return_value = None
            mock_client.return_value = mock_instance

            client = CapabilityClient()
            result = await client.call(
                config=config,
                request={
                    "model": "text-embedding-3-small",
                    "input": ["Hello world"],
                    "encoding_format": "float",
                },
                headers={"Authorization": "Bearer sk-xxx"},
            )

            # OpenAI 响应原样返回
            assert result["data"][0]["embedding"] == [0.1, 0.2, 0.3]

    @pytest.mark.asyncio
    async def test_full_flow_custom_provider(self):
        """自定义提供商的完整流程。"""
        # 1. 自定义提供商配置（字段名不同于 OpenAI）
        provider_meta = {
            "capabilities": {
                "embedding": {
                    "endpoint": "/api/v2/embed",
                    "request_map": {
                        "texts": "input",  # input -> texts
                        "model_id": "model",  # model -> model_id
                    },
                    "response_map": {
                        "embeddings": "results[*].vector",  # 提取嵌入向量
                        "dimensions": "results[0].dimensions",
                    },
                    "defaults": {
                        "truncate": True,
                    },
                }
            }
        }

        # 2. 解析能力配置
        config = resolve_capability_config(
            provider_meta=provider_meta,
            capability="embedding",
            base_url="https://custom.api",
        )
        assert config is not None
        assert config.request_map == {
            "texts": "input",
            "model_id": "model",
        }

        # 3. 模拟调用
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": [
                {"vector": [0.5, 0.6, 0.7], "dimensions": 3},
            ],
            "meta": {"tokens_used": 10},
        }

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.request.return_value = mock_response
            mock_instance.__aenter__.return_value = mock_instance
            mock_instance.__aexit__.return_value = None
            mock_client.return_value = mock_instance

            client = CapabilityClient()
            result = await client.call(
                config=config,
                request={
                    "model": "embed-v1",
                    "input": ["Hello"],
                },
                headers={"X-API-Key": "custom-key"},
            )

            # 验证请求已转换
            call_args = mock_instance.request.call_args
            sent_json = call_args.kwargs["json"]
            assert sent_json["texts"] == ["Hello"]  # input -> texts
            assert sent_json["model_id"] == "embed-v1"  # model -> model_id
            assert sent_json["truncate"] is True  # 默认值已应用

            # 验证响应已适配
            assert result["embeddings"] == [[0.5, 0.6, 0.7]]
            assert result["dimensions"] == 3


class TestEmbedTextIntegration:
    """embed_text 服务集成测试。"""

    def _make_api_key(self) -> AuthenticatedAPIKey:
        return AuthenticatedAPIKey(
            id=uuid4(),
            user_id=uuid4(),
            user_username="admin",
            is_superuser=True,
            name="test",
            is_active=True,
            disabled_reason=None,
            has_provider_restrictions=False,
            allowed_provider_ids=[],
        )

    @pytest.mark.asyncio
    async def test_embed_text_success(self):
        """测试 embed_text 成功流程。"""
        # Mock DB
        mock_db = MagicMock()
        mock_provider = MagicMock()
        mock_provider.id = uuid4()
        mock_provider.provider_id = "test-provider"
        mock_provider.metadata_json = {"capabilities": {"embedding": {"endpoint": "/embed"}}}
        mock_provider.base_url = "https://test.com"
        
        mock_provider_model = MagicMock()
        mock_provider_model.metadata_json = {}
        
        mock_api_key = MagicMock()
        mock_api_key.encrypted_key = b"encrypted"

        # Setup DB scalars return values
        # 1. Provider
        # 2. ProviderModel
        # 3. ProviderAPIKey
        mock_db.scalar.side_effect = [mock_provider, mock_provider_model, mock_api_key]

        # Mock ProviderSelector
        mock_upstream = MagicMock()
        mock_upstream.provider_id = "test-provider"
        mock_upstream.model_id = "test-model"
        
        mock_candidate = MagicMock()
        mock_candidate.upstream = mock_upstream
        
        mock_selection = MagicMock()
        mock_selection.ordered_candidates = [mock_candidate]

        # Mock CapabilityClient
        with patch("app.services.embedding_service.ProviderSelector") as MockSelector, \
             patch("app.services.embedding_service.decrypt_secret", return_value="secret-key"), \
             patch("app.services.embedding_service.CapabilityClient") as MockClientCls:
            
            # Setup Selector
            mock_selector_instance = AsyncMock()
            mock_selector_instance.select.return_value = mock_selection
            MockSelector.return_value = mock_selector_instance

            # Setup CapabilityClient
            mock_client_instance = AsyncMock()
            mock_client_instance.call.return_value = {
                "data": [{"embedding": [0.1, 0.2, 0.3]}]
            }
            MockClientCls.return_value = mock_client_instance

            result = await embed_text(
                db=mock_db,
                redis=AsyncMock(),
                client=AsyncMock(),
                api_key=self._make_api_key(),
                effective_provider_ids={"test-provider"},
                embedding_logical_model="test-model",
                text="hello",
                idempotency_key="key"
            )

            assert result == [0.1, 0.2, 0.3]
            
            # Verify Selector called
            mock_selector_instance.select.assert_called_once()
            
            # Verify CapabilityClient called with correct config and headers
            mock_client_instance.call.assert_called_once()
            call_kwargs = mock_client_instance.call.call_args.kwargs
            assert call_kwargs["headers"]["Authorization"] == "Bearer secret-key"
            assert call_kwargs["request"]["model"] == "test-model"
            assert call_kwargs["config"].endpoint == "https://test.com/embed"

    @pytest.mark.asyncio
    async def test_embed_text_no_candidates(self):
        """测试无可用候选时返回 None。"""
        with patch("app.services.embedding_service.ProviderSelector") as MockSelector:
            mock_selector_instance = AsyncMock()
            # Return empty candidates
            mock_selector_instance.select.return_value = MagicMock(ordered_candidates=[])
            MockSelector.return_value = mock_selector_instance

            result = await embed_text(
                db=MagicMock(),
                redis=AsyncMock(),
                client=AsyncMock(),
                api_key=self._make_api_key(),
                effective_provider_ids=set(),
                embedding_logical_model="unknown-model",
                text="hello",
                idempotency_key="key"
            )

            assert result is None