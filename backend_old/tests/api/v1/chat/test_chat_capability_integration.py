"""
Chat Capability Main Chain Integration Test.

Verifies:
1. ProviderSelector -> try_candidates_* -> execute_capability_transport (when capability present)
2. Fallback to execute_http_transport (when capability missing)
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.api.v1.chat.request_handler import RequestHandler
from app.auth import AuthenticatedAPIKey
from app.schemas import LogicalModel, PhysicalModel
from app.routing.scheduler import CandidateScore
from app.api.v1.chat.provider_selector import ProviderSelectionResult
from app.services.provider.capability_resolver import CapabilityConfig, resolve_capability_config

@pytest.fixture
def mock_api_key():
    return AuthenticatedAPIKey(
        id=uuid4(),
        user_id=uuid4(),
        user_username="test_user",
        is_superuser=False,
        name="Test API Key",
        is_active=True,
        disabled_reason=None,
        has_provider_restrictions=False,
        allowed_provider_ids=[],
    )

@pytest.fixture
def request_handler(mock_api_key):
    redis = AsyncMock()
    return RequestHandler(
        api_key=mock_api_key,
        db=MagicMock(),
        redis=redis,
        client=AsyncMock(),
    )

@pytest.fixture
def mock_provider_config():
    config = MagicMock()
    config.id = "test-provider"
    config.base_url = "https://api.test.com"
    config.metadata = {"capabilities": {"chat": {"endpoint": "/v1/test/chat"}}}
    config.transport = "http"
    return config

@pytest.mark.asyncio
async def test_handle_uses_capability_transport_when_config_present(
    request_handler, mock_provider_config
):
    # Setup
    payload = {"model": "gpt-4", "messages": [{"role": "user", "content": "hi"}]}
    
    upstream = PhysicalModel(
        provider_id="test-provider",
        model_id="test-model",
        endpoint="https://api.test.com/v1/test/chat",
        base_weight=1.0,
        updated_at=0,
    )
    selection = ProviderSelectionResult(
        logical_model=MagicMock(spec=LogicalModel),
        ordered_candidates=[CandidateScore(upstream=upstream, score=1.0)],
        scored_candidates=[],
        base_weights={"test-provider": 1.0}
    )

    # Mocks
    with patch.object(request_handler.provider_selector, "select", return_value=selection), \
         patch("app.api.v1.chat.candidate_retry.get_provider_config", return_value=mock_provider_config), \
         patch("app.api.v1.chat.candidate_retry.resolve_capability_config") as mock_resolve, \
         patch("app.api.v1.chat.candidate_retry.execute_capability_transport") as mock_exec_cap, \
         patch("app.api.v1.chat.candidate_retry.execute_http_transport") as mock_exec_http, \
         patch("app.api.v1.chat.request_handler.apply_response_moderation", return_value={"ok": True}), \
         patch("app.api.v1.chat.request_handler.record_completion_usage"):

        # Mock Capability Resolution
        cap_config = CapabilityConfig(
            capability="chat",
            endpoint="https://api.test.com/v1/test/chat"
        )
        mock_resolve.return_value = cap_config
        
        # Mock Execution Result
        mock_transport_result = MagicMock()
        mock_transport_result.success = True
        mock_transport_result.response = MagicMock(status_code=200)
        mock_exec_cap.return_value = mock_transport_result

        # Act
        await request_handler.handle(
            payload=payload,
            requested_model="gpt-4",
            lookup_model_id="gpt-4",
            api_style="openai",
            effective_provider_ids={"test-provider"}
        )

        # Assert
        # Should call resolve_capability_config
        mock_resolve.assert_called_once()
        
        # Should call execute_capability_transport
        mock_exec_cap.assert_called_once()
        call_kwargs = mock_exec_cap.call_args.kwargs
        assert call_kwargs["capability_config"] == cap_config
        assert call_kwargs["provider_id"] == "test-provider"
        
        # Should NOT call execute_http_transport
        mock_exec_http.assert_not_called()

@pytest.mark.asyncio
async def test_handle_fallbacks_to_legacy_when_capability_missing(
    request_handler, mock_provider_config
):
    # Setup: Provider config has NO capabilities
    mock_provider_config.metadata = {}
    
    upstream = PhysicalModel(
        provider_id="test-provider",
        model_id="test-model",
        endpoint="https://api.test.com/legacy",
        base_weight=1.0,
        updated_at=0,
    )
    selection = ProviderSelectionResult(
        logical_model=MagicMock(spec=LogicalModel),
        ordered_candidates=[CandidateScore(upstream=upstream, score=1.0)],
        scored_candidates=[],
        base_weights={"test-provider": 1.0}
    )

    # Mocks
    with patch.object(request_handler.provider_selector, "select", return_value=selection), \
         patch("app.api.v1.chat.candidate_retry.get_provider_config", return_value=mock_provider_config), \
         patch("app.api.v1.chat.candidate_retry.execute_capability_transport") as mock_exec_cap, \
         patch("app.api.v1.chat.candidate_retry.execute_http_transport") as mock_exec_http, \
         patch("app.api.v1.chat.request_handler.apply_response_moderation", return_value={"ok": True}), \
         patch("app.api.v1.chat.request_handler.record_completion_usage"):

        # Mock Execution Result
        mock_transport_result = MagicMock()
        mock_transport_result.success = True
        mock_transport_result.response = MagicMock(status_code=200)
        mock_exec_http.return_value = mock_transport_result

        # Act
        await request_handler.handle(
            payload={"model": "gpt-4"},
            requested_model="gpt-4",
            lookup_model_id="gpt-4",
            api_style="openai",
            effective_provider_ids={"test-provider"}
        )

        # Assert
        # Should NOT call execute_capability_transport
        mock_exec_cap.assert_not_called()
        
        # Should call execute_http_transport
        mock_exec_http.assert_called_once()
