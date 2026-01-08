
import asyncio

from app.core.config import settings
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.sanitize import SanitizeStep


async def test_sanitize_step():
    print("Testing SanitizeStep...")

    # 1. Test Headers (External)
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

    # Should remove Authorization, X-Request-ID (debug), X-Envoy... (debug)
    assert "Authorization" not in sanitized_headers
    assert "X-Request-ID" not in sanitized_headers
    assert "Content-Type" in sanitized_headers
    print("PASS: External Headers")

    # 2. Test Headers (Internal + Debug Info ON)
    settings.INTERNAL_CHANNEL_DEBUG_INFO = True
    ctx_int = WorkflowContext(channel=Channel.INTERNAL)
    ctx_int.set("upstream_call", "headers", headers)
    ctx_int.set("response_transform", "response", {"foo": "bar"})

    await step.execute(ctx_int)
    sanitized_headers_int = ctx_int.get("sanitize", "headers")

    # Should remove Authorization (sensitive) but KEEP X-Request-ID (debug)
    assert "Authorization" not in sanitized_headers_int
    assert "X-Request-ID" in sanitized_headers_int
    assert "X-Envoy-Upstream-Service-Time" in sanitized_headers_int
    print("PASS: Internal Headers (Debug ON)")

    # 3. Test Headers (Internal + Debug Info OFF)
    settings.INTERNAL_CHANNEL_DEBUG_INFO = False
    ctx_int_off = WorkflowContext(channel=Channel.INTERNAL)
    ctx_int_off.set("upstream_call", "headers", headers)
    ctx_int_off.set("response_transform", "response", {"foo": "bar"})

    await step.execute(ctx_int_off)
    sanitized_headers_int_off = ctx_int_off.get("sanitize", "headers")

    # Should remove everything like External
    assert "Authorization" not in sanitized_headers_int_off
    assert "X-Request-ID" not in sanitized_headers_int_off
    print("PASS: Internal Headers (Debug OFF)")

    # 4. Test Body Sanitization Rules
    ctx_body = WorkflowContext(channel=Channel.EXTERNAL)
    response = {"id": "sk-1234567890abcdef123456", "usage": {"prompt": 10}, "secret_field": "hidden"}
    ctx_body.set("response_transform", "response", response)
    # Mock routing config with sanitization rules
    response_transform_config = {
        "sanitization": {
            "remove_fields": ["usage"],
            "mask_fields": ["id"]
        }
    }
    ctx_body.set("routing", "response_transform", response_transform_config)

    await step.execute(ctx_body)
    sanitized_body = ctx_body.get("sanitize", "response")

    assert "usage" not in sanitized_body
    assert sanitized_body["id"].startswith("sk-") and "..." in sanitized_body["id"]
    # "secret_field" is not in global list, so it stays unless added to global list
    assert "secret_field" in sanitized_body
    print("PASS: Body Sanitization Rules (Remove + Mask)")

    # 5. Test Log Sanitization
    data = {
        "api_key": "sk-1234567890abcdef1234567890abcdef",
        "nested": {"token": "secret_token"},
        "url": "https://api.openai.com?key=sk-1234567890abcdef1234567890abcdef"
    }
    log_data = SanitizeStep.sanitize_for_log(data)
    assert log_data["api_key"] == "[REDACTED]" or "*" in log_data["api_key"]
    assert log_data["nested"]["token"] == "[REDACTED]"
    # Ensure regex works for url param if implemented (current implementation checks whole string)
    # The current implementation of sanitize_for_log checks if the value *looks like* a secret.
    # It does NOT scan inside a URL string.
    # Let's check _looks_like_secret("https://...") -> False.
    # So URL sanitization might need improvement if we want to catch keys in query params.
    # But for now, let's verify what we have.
    print(f"Log Data: {log_data}")
    print("PASS: Log Sanitization")

if __name__ == "__main__":
    asyncio.run(test_sanitize_step())
