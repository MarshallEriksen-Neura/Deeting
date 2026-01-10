from fastapi.testclient import TestClient


def test_unhandled_exception_returns_structured_error(app_with_inmemory_db):
    app, _ = app_with_inmemory_db

    @app.get("/__raise_unhandled_error")
    async def raise_error():
        raise RuntimeError("boom")

    with TestClient(app) as client:
        response = client.get("/__raise_unhandled_error")

    assert response.status_code == 500
    payload = response.json()
    assert payload["error_code"] == "internal_error"
    assert payload["message"] == "服务器内部错误，请稍后再试"
    assert payload["error_id"]
