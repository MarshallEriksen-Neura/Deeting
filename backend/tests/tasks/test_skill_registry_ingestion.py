from app.tasks.skill_registry import ingest_skill_repo


def test_ingest_skill_repo_task(monkeypatch):
    async def fake_run(*_args, **_kwargs):
        return "ok"

    monkeypatch.setattr(
        "app.tasks.skill_registry._run_repo_ingestion",
        fake_run,
    )
    assert ingest_skill_repo("https://example.com/repo.git") == "ok"
