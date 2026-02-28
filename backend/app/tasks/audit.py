import uuid
from typing import Any

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.db_sync import get_sync_db
from app.core.logging import logger
from app.models.gateway_log import GatewayLog


def _parse_uuid(value: Any, field: str) -> uuid.UUID | None:
    if value is None or value == "":
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except Exception:
        logger.warning("audit_invalid_uuid field=%s value=%s", field, value)
        return None


def _is_connection_exhausted_error(exc: OperationalError) -> bool:
    error_text = str(getattr(exc, "orig", exc)).lower()
    return (
        "too many clients" in error_text
        or "remaining connection slots are reserved" in error_text
    )


@celery_app.task(name="app.tasks.audit.record_audit_log")
def record_audit_log_task(log_data: dict[str, Any]) -> str:
    """
    异步记录审计日志 (GatewayLog)
    """
    db_gen = get_sync_db()
    db: Session = next(db_gen)
    try:
        # 转换 UUID 字段
        for field in ("user_id", "api_key_id", "preset_id"):
            if field in log_data:
                log_data[field] = _parse_uuid(log_data.get(field), field)

        log_entry = GatewayLog(**log_data)
        db.add(log_entry)
        db.commit()
        return f"Audit log recorded: {log_entry.id}"
    except OperationalError as exc:
        db.rollback()
        if _is_connection_exhausted_error(exc):
            logger.warning("audit_log_skip_db_connection_exhausted err=%s", exc)
            return "Skipped: database connections exhausted"
        logger.error("Failed to record audit log: %s", exc)
        raise
    except Exception as exc:
        logger.error("Failed to record audit log: %s", exc)
        db.rollback()
        raise
    finally:
        close = getattr(db_gen, "close", None)
        if callable(close):
            close()
        else:
            db.close()
