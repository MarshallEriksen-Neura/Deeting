import pytest

from app.schemas import ProviderConfig
from app.services.chat_routing_service import _select_provider_endpoint
from app.services.provider.capability_resolver import resolve_capability_config
from app.services.provider.request_transformer import RequestTransformer
from app.services.provider.response_adapter import ResponseAdapter


@pytest.mark.asyncio
async def test_capability_integration_flow():
    """End-to-end capability mapping: resolver -> routing -> transform -> adapt."""
    provider_meta = {
        "capabilities": {
            "chat": {
                "endpoint": "/v1/custom/chat",
                "adapter": "openai",  # maps to api_style="openai"
                "request_map": {
                    "model_id": "model",
                    "input_messages": "messages",
                },
                "response_map": {
                    "id": "response_id",
                    "output_content": "output_text",
                },
            }
        }
    }

    cfg = ProviderConfig(
        id="test-provider",
        name="Test Provider",
        base_url="https://api.test.com",
        metadata=provider_meta,
    )

    # Capability resolver returns structured config with full endpoint
    cap_config = resolve_capability_config(
        provider_meta=cfg.metadata,
        capability="chat",
        base_url=str(cfg.base_url),
    )
    assert cap_config is not None
    assert cap_config.endpoint == "https://api.test.com/v1/custom/chat"
    assert cap_config.request_map == {"model_id": "model", "input_messages": "messages"}

    # Routing picks endpoint/style from capability metadata
    selection = _select_provider_endpoint(cfg, "openai", capability="chat")
    assert selection is not None
    assert selection.url == "https://api.test.com/v1/custom/chat"
    assert selection.api_style == "openai"

    # Request transformation applies request_map and drops original keys
    transformer = RequestTransformer()
    request_payload = {"model": "gpt-4", "messages": [{"role": "user", "content": "hi"}]}
    transformed = transformer.transform_with_config(request_payload, cap_config)
    assert transformed["model_id"] == "gpt-4"
    assert transformed["input_messages"] == [{"role": "user", "content": "hi"}]
    assert "model" not in transformed

    # Response adaptation follows response_map
    adapter = ResponseAdapter()
    upstream_response = {"response_id": "resp-123", "output_text": "Hello world"}
    standard_response = adapter.adapt_with_config(upstream_response, cap_config)
    assert standard_response["id"] == "resp-123"
    assert standard_response["output_content"] == "Hello world"
