from __future__ import annotations

from sqlalchemy import select

from app.models import AgentTask, AgentTaskStatus, AgentTaskType, User
from tests.utils import jwt_auth_headers


def _superuser_headers(session) -> dict[str, str]:
    user = session.execute(select(User).limit(1)).scalars().first()
    return jwt_auth_headers(str(user.id))


def test_list_tasks_supports_limit_offset_and_task_type_filter(client, db_session):
    headers = _superuser_headers(db_session)

    task_pending = AgentTask(
        task_type=AgentTaskType.CRAWL.value,
        status=AgentTaskStatus.PENDING.value,
        target_url="https://example.com",
    )
    task_completed = AgentTask(
        task_type=AgentTaskType.UPLOAD.value,
        status=AgentTaskStatus.COMPLETED.value,
        target_file_path="/tmp/file.txt",
    )
    db_session.add_all([task_pending, task_completed])
    db_session.commit()

    response = client.get(
        "/v1/admin/agents/tasks?limit=1&offset=0&task_type=crawl",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["page"] == 1
    assert data["page_size"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["task_type"] == AgentTaskType.CRAWL.value
    assert data["items"][0]["status"] == AgentTaskStatus.PENDING.value


def test_list_tasks_keeps_legacy_page_params(client, db_session):
    headers = _superuser_headers(db_session)

    tasks = [
        AgentTask(task_type=AgentTaskType.CRAWL.value, status=AgentTaskStatus.PENDING.value),
        AgentTask(task_type=AgentTaskType.UPLOAD.value, status=AgentTaskStatus.COMPLETED.value),
    ]
    db_session.add_all(tasks)
    db_session.commit()

    response = client.get(
        "/v1/admin/agents/tasks?page=2&page_size=1",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 2
    assert data["page_size"] == 1
    assert len(data["items"]) == 1
