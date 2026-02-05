from uuid import uuid4

import pytest

from app.deps.auth import get_current_user
from app.models import User
from main import app


@pytest.mark.asyncio
async def test_create_trace_feedback(client):
    async def fake_user():
        return User(
            id=uuid4(),
            email="tester@example.com",
            username="tester",
            hashed_password="",
            is_active=True,
            is_superuser=False,
        )

    app.dependency_overrides[get_current_user] = fake_user
    try:
        payload = {
            "trace_id": "trace_feedback_test",
            "score": 1.0,
            "comment": "ok",
            "tags": ["ui"],
        }
        resp = await client.post("/api/v1/feedback", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["trace_id"] == payload["trace_id"]
        assert data["score"] == payload["score"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
