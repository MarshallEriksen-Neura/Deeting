import uuid

from app.tasks.skill_registry import sync_skill_to_qdrant


def test_sync_task_no_qdrant(monkeypatch):
    monkeypatch.setattr("app.tasks.skill_registry.qdrant_is_configured", lambda: False)
    result = sync_skill_to_qdrant(str(uuid.uuid4()))
    assert result == "skipped"
