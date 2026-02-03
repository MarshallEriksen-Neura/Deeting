from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.tasks import search_index


def test_rebuild_all_task_runs_async(monkeypatch) -> None:
    mock = AsyncMock(return_value="ok")
    monkeypatch.setattr(search_index, "_run_rebuild_all", mock)

    assert search_index.rebuild_all_task() == "ok"
    mock.assert_awaited_once()


@pytest.mark.parametrize(
    ("task_name", "target_name"),
    [
        ("upsert_mcp_tool_task", "_run_upsert_mcp_tool"),
        ("delete_mcp_tool_task", "_run_delete_mcp_tool"),
        ("upsert_provider_preset_task", "_run_upsert_provider_preset"),
        ("delete_provider_preset_task", "_run_delete_provider_preset"),
        ("upsert_assistant_task", "_run_upsert_assistant"),
        ("delete_assistant_task", "_run_delete_assistant"),
    ],
)
def test_entity_tasks_run_async(monkeypatch, task_name: str, target_name: str) -> None:
    mock = AsyncMock(return_value="ok")
    monkeypatch.setattr(search_index, target_name, mock)

    task = getattr(search_index, task_name)
    assert task("item-id") == "ok"
    mock.assert_awaited_once()
