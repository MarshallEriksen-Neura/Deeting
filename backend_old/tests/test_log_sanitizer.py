import logging

from app.log_sanitizer import REDACTED, sanitize_headers_for_log


def test_sanitize_headers_for_log_redacts_common_secrets():
    sanitized = sanitize_headers_for_log(
        {
            "x-api-key": "sk-test-123",
            "Authorization": "Bearer secret",
            "Cookie": "a=b",
            "User-Agent": "pytest",
        }
    )
    assert sanitized["x-api-key"] == REDACTED
    assert sanitized["Authorization"] == REDACTED
    assert sanitized["Cookie"] == REDACTED
    assert sanitized["User-Agent"] == "pytest"


def test_request_logging_middleware_does_not_leak_api_key(client, caplog):
    caplog.set_level(logging.INFO, logger="apiproxy")

    secret_key = "sk-test-should-not-appear"
    secret_auth = "Bearer should-not-appear"
    secret_cookie = "session=should-not-appear"
    client.get(
        "/__test_log_sanitizer_not_found__",
        headers={
            "x-api-key": secret_key,
            "Authorization": secret_auth,
            "Cookie": secret_cookie,
        },
    )

    joined = "\n".join(record.getMessage() for record in caplog.records)
    assert secret_key not in joined
    assert secret_auth not in joined
    assert secret_cookie not in joined
    assert REDACTED in joined

