import uuid
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.v1.external import gateway


def _make_request(path: str = "/external/v1/chat/completions") -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "path": path,
        "headers": [(b"x-api-key", b"sk-ext-test")],
    }
    request = Request(scope)
    request.state.trace_id = "trace-test"
    return request


@pytest.mark.asyncio
async def test_resolve_external_user_id_prefers_principal_user_id(mocker):
    request = _make_request()
    validate_mock = mocker.patch(
        "app.api.v1.external.gateway.ApiKeyService.validate_key",
        new=mocker.AsyncMock(return_value=None),
    )

    uid = str(uuid.uuid4())
    result = await gateway._resolve_external_user_id(
        request,
        "/external/v1/chat/completions",
        db=None,
        principal=SimpleNamespace(user_id=uid),
    )

    assert result == uid
    validate_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_external_user_id_returns_none_for_unbound_key(mocker):
    request = _make_request()
    mocker.patch(
        "app.api.v1.external.gateway.ApiKeyService.validate_key",
        new=mocker.AsyncMock(return_value=SimpleNamespace(user_id=None)),
    )

    result = await gateway._resolve_external_user_id(
        request,
        "/external/v1/chat/completions",
        db=None,
    )

    assert result is None


def test_external_user_required_response_returns_401():
    request = _make_request()

    resp = gateway._external_user_required_response(request)

    assert resp.status_code == 401
    assert resp.body
    payload = resp.body.decode("utf-8")
    assert "INVALID_API_KEY" in payload
    assert "trace-test" in payload
