import pytest

from app.api.v1.internal.skill_execution_route import get_executor
from main import app


@pytest.mark.asyncio
async def test_internal_skill_execute_returns_artifacts(client, auth_tokens, monkeypatch):
    class FakeExecutor:
        async def execute(self, *_args, **_kwargs):
            return {
                "status": "ok",
                "stdout": ["ok"],
                "stderr": [],
                "exit_code": 0,
                "artifacts": [
                    {"name": "output_docx", "type": "file", "path": "/workspace/output.docx"}
                ],
            }

    prev_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_executor] = lambda: FakeExecutor()

    resp = await client.post(
        "/api/v1/internal/skills/docx/execute",
        json={"inputs": {}, "intent": "edit"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )

    try:
        assert resp.status_code == 200
        assert resp.json()["artifacts"]
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prev_overrides)
