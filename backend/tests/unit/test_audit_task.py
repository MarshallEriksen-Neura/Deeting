from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import OperationalError

from app.tasks.audit import record_audit_log_task


def test_record_audit_log_task_handles_invalid_uuid_fields():
    db = MagicMock()
    with patch("app.tasks.audit.get_sync_db") as mock_get_sync_db:
        mock_get_sync_db.return_value = iter([db])
        preset_id = uuid4()
        payload = {
            "model": "gpt-4",
            "status_code": 200,
            "duration_ms": 12,
            "input_tokens": 1,
            "output_tokens": 2,
            "total_tokens": 3,
            "cost_user": 0.01,
            "user_id": "not-a-uuid",
            "api_key_id": "also-bad",
            "preset_id": str(preset_id),
        }

        result = record_audit_log_task(payload)

    assert "Audit log recorded" in result
    db.add.assert_called_once()
    log_entry = db.add.call_args[0][0]
    assert log_entry.user_id is None
    assert log_entry.api_key_id is None
    assert isinstance(log_entry.preset_id, UUID)
    assert log_entry.preset_id == preset_id


def test_record_audit_log_task_skips_when_db_connections_exhausted():
    db = MagicMock()
    db.commit.side_effect = OperationalError(
        "INSERT INTO gateway_logs ...",
        {},
        Exception("FATAL: sorry, too many clients already"),
    )

    with patch("app.tasks.audit.get_sync_db") as mock_get_sync_db:
        mock_get_sync_db.return_value = iter([db])
        payload = {
            "model": "gpt-4",
            "status_code": 200,
            "duration_ms": 12,
            "input_tokens": 1,
            "output_tokens": 2,
            "total_tokens": 3,
            "cost_user": 0.01,
        }
        result = record_audit_log_task(payload)

    assert result == "Skipped: database connections exhausted"
    db.rollback.assert_called_once()


def test_record_audit_log_task_raises_other_operational_errors():
    db = MagicMock()
    db.commit.side_effect = OperationalError(
        "INSERT INTO gateway_logs ...",
        {},
        Exception("connection refused"),
    )

    with patch("app.tasks.audit.get_sync_db") as mock_get_sync_db:
        mock_get_sync_db.return_value = iter([db])
        payload = {
            "model": "gpt-4",
            "status_code": 200,
            "duration_ms": 12,
            "input_tokens": 1,
            "output_tokens": 2,
            "total_tokens": 3,
            "cost_user": 0.01,
        }
        with pytest.raises(OperationalError):
            record_audit_log_task(payload)

    db.rollback.assert_called_once()
