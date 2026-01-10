
import pytest
from app.core.config import settings
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.sanitize import SanitizeStep
from app.services.workflow.steps.base import StepStatus

@pytest.mark.asyncio
async def test_sanitize_headers_external():
    step = SanitizeStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    headers = {
        "Authorization": "Bearer secret",
        "X-Request-ID": "req-123",
        "Content-Type": "application/json",
        "X-Envoy-Upstream-Service-Time": "100"
    }
    ctx.set("upstream_call", "headers", headers)
    ctx.set("response_transform", "response", {"foo": "bar"})

    await step.execute(ctx)
    sanitized_headers = ctx.get("sanitize", "headers")

    assert "Authorization" not in sanitized_headers
    assert "X-Request-ID" not in sanitized_headers
    assert "X-Envoy-Upstream-Service-Time" not in sanitized_headers
    assert sanitized_headers["Content-Type"] == "application/json"

@pytest.mark.asyncio
async def test_sanitize_headers_internal_debug_on():
    with patch_settings(INTERNAL_CHANNEL_DEBUG_INFO=True):
        step = SanitizeStep()
        ctx = WorkflowContext(channel=Channel.INTERNAL)
        headers = {
            "Authorization": "Bearer secret",
            "X-Request-ID": "req-123",
            "X-Envoy-Upstream-Service-Time": "100"
        }
        ctx.set("upstream_call", "headers", headers)
        ctx.set("response_transform", "response", {"foo": "bar"})

        await step.execute(ctx)
        sanitized_headers = ctx.get("sanitize", "headers")

        assert "Authorization" not in sanitized_headers
        assert sanitized_headers["X-Request-ID"] == "req-123"
        assert sanitized_headers["X-Envoy-Upstream-Service-Time"] == "100"

@pytest.mark.asyncio
async def test_sanitize_body_rules():
    step = SanitizeStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    response = {
        "id": "sk-1234567890abcdef123456",
        "usage": {"prompt": 10},
        "secret_field": "hidden"
    }
    ctx.set("response_transform", "response", response)
    
    # Mock routing config with sanitization rules
    response_transform_config = {
        "sanitization": {
            "remove_fields": ["usage"],
            "mask_fields": ["id"]
        }
    }
    ctx.set("routing", "response_transform", response_transform_config)

    await step.execute(ctx)
    sanitized_body = ctx.get("sanitize", "response")

    assert "usage" not in sanitized_body
    assert "id" in sanitized_body
    assert "..." in sanitized_body["id"]
    assert sanitized_body["secret_field"] == "hidden"

def test_sanitize_for_log():
    data = {
        "api_key": "sk-1234567890abcdef1234567890abcdef",
        "nested": {"token": "secret_token"},
        "password": "my-password"
    }
    log_data = SanitizeStep.sanitize_for_log(data)
    assert log_data["api_key"] == "[REDACTED]"
    assert log_data["nested"]["token"] == "[REDACTED]"
    assert log_data["password"] == "[REDACTED]"

class patch_settings:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.originals = {}

    def __enter__(self):
        for k, v in self.kwargs.items():
            self.originals[k] = getattr(settings, k)
            setattr(settings, k, v)
        return settings

    def __exit__(self, exc_type, exc_val, exc_tb):
        for k, v in self.originals.items():
            setattr(settings, k, v)
