import pytest
from types import SimpleNamespace

from app.api.v1.admin import discovery_route


class DummyTask:
    def __init__(self):
        self.kwargs = None

    def apply_async(self, kwargs=None, args=None):
        self.kwargs = kwargs or {}
        return SimpleNamespace(id="task-123")


@pytest.mark.asyncio
async def test_discovery_task_passes_provider_name_hint(client, monkeypatch):
    dummy_task = DummyTask()
    monkeypatch.setattr(discovery_route, "run_discovery_task", dummy_task)

    payload = {
        "target_url": "https://example.com/docs",
        "capability": "chat",
        "model_hint": "gpt-4o",
        "provider_name_hint": "ExampleAI",
    }

    resp = await client.post("/api/v1/discovery/tasks", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["task_id"] == "task-123"
    assert data["status"] == "queued"
    assert dummy_task.kwargs["provider_name_hint"] == "ExampleAI"
    assert dummy_task.kwargs["model_hint"] == "gpt-4o"
