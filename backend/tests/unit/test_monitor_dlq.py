from __future__ import annotations

from types import SimpleNamespace

from app.tasks import monitor as monitor_tasks


def test_is_final_retry_true():
    task_ctx = SimpleNamespace(request=SimpleNamespace(retries=3))
    assert monitor_tasks._is_final_retry(task_ctx, max_retries=3) is True


def test_is_final_retry_false():
    task_ctx = SimpleNamespace(request=SimpleNamespace(retries=1))
    assert monitor_tasks._is_final_retry(task_ctx, max_retries=3) is False


def test_enqueue_dead_letter_dispatch(monkeypatch):
    calls: list[dict] = []

    def _fake_delay(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(monitor_tasks.dead_letter_task, "delay", _fake_delay)

    monitor_tasks._enqueue_dead_letter(
        worker="reasoning_worker",
        task_id="task-1",
        payload={"task_id": "task-1"},
        error_message="boom",
        retry_count=3,
    )

    assert len(calls) == 1
    assert calls[0]["worker"] == "reasoning_worker"
    assert calls[0]["task_id"] == "task-1"
