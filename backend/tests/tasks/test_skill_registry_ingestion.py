from app.tasks.skill_registry import ingest_skill_repo


def test_ingest_skill_repo_task(monkeypatch):
    async def fake_run(*_args, **_kwargs):
        return "ok"

    monkeypatch.setattr(
        "app.tasks.skill_registry._run_repo_ingestion",
        fake_run,
    )
    assert ingest_skill_repo("https://example.com/repo.git") == "ok"


def test_ingest_skill_repo_triggers_dry_run(monkeypatch):
    async def fake_run(*_args, **_kwargs):
        return {"skill_id": "core.tools.docx", "status": "created"}

    called: dict[str, str] = {}

    def fake_trigger(skill_id: str) -> None:
        called["skill_id"] = skill_id

    monkeypatch.setattr(
        "app.tasks.skill_registry._run_repo_ingestion",
        fake_run,
    )
    monkeypatch.setattr(
        "app.tasks.skill_registry._trigger_dry_run",
        fake_trigger,
    )

    result = ingest_skill_repo("https://example.com/repo.git")

    assert result == {"skill_id": "core.tools.docx", "status": "created"}
    assert called["skill_id"] == "core.tools.docx"
