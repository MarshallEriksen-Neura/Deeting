from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

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
