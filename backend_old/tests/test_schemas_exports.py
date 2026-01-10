def test_schemas_exports_run_summary() -> None:
    from app.schemas import RunSummary

    assert RunSummary.__name__ == "RunSummary"

