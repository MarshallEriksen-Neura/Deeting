from __future__ import annotations

import app.services.code_mode.audit_service as audit_module


def test_sanitize_arguments_masks_sensitive_keys():
    service = audit_module.CodeModeAuditService()

    payload = {
        "url": "https://example.com",
        "api_key": "sk-1234567890",
        "nested": {"access_token": "tok-1234"},
    }
    sanitized = service.sanitize_arguments(payload)

    assert sanitized["url"] == "https://example.com"
    assert sanitized["api_key"] == "***"
    assert sanitized["nested"]["access_token"] == "***"


def test_record_bridge_call_logs_sanitized_arguments(monkeypatch):
    service = audit_module.CodeModeAuditService()
    captured = {}

    def _fake_logger(message, *, extra):
        captured["message"] = message
        captured["extra"] = extra

    monkeypatch.setattr(audit_module.logger, "info", _fake_logger)

    service.record_bridge_call(
        tool_name="fetch_web_content",
        arguments={"url": "https://example.com", "token": "secret-value"},
        status="success",
        duration_ms=12.5,
        trace_id="trace-001",
        session_id="sess-001",
        user_id="u-001",
        call_index=1,
        max_calls=8,
    )

    assert captured["message"] == "code_mode_bridge_audit"
    assert captured["extra"]["tool_name"] == "fetch_web_content"
    assert captured["extra"]["arguments"]["url"] == "https://example.com"
    assert captured["extra"]["arguments"]["token"] == "***"
    assert captured["extra"]["status"] == "success"
