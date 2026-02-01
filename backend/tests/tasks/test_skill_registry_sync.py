import uuid

from app.tasks.skill_registry import _build_embedding_text, sync_skill_to_qdrant


def test_sync_task_no_qdrant(monkeypatch):
    monkeypatch.setattr("app.tasks.skill_registry.qdrant_is_configured", lambda: False)
    result = sync_skill_to_qdrant(str(uuid.uuid4()))
    assert result == "skipped"


def test_build_embedding_text_includes_manifest_fields():
    class Dummy:
        id = "docx"
        name = "Docx Skill"
        status = "active"
        description = "docx editor"
        manifest_json = {"capabilities": ["docx", "comments"]}

    text = _build_embedding_text(Dummy())
    assert "docx editor" in text
    assert "comments" in text
