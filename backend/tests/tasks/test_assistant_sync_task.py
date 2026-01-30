import uuid

from app.tasks.assistant import sync_assistant_to_qdrant


def test_sync_task_no_qdrant(monkeypatch):
    monkeypatch.setattr("app.tasks.assistant.qdrant_is_configured", lambda: False)
    result = sync_assistant_to_qdrant(str(uuid.uuid4()))
    assert result == "skipped"
