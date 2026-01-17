import uuid
from typing import Any

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
    except Exception:  # noqa: BLE001
        logger.warning("audit_invalid_uuid field=%s value=%s", field, value)
        return None


@celery_app.task(name="app.tasks.audit.record_audit_log")
def record_audit_log_task(log_data: dict[str, Any]) -> str:
    """
    异步记录审计日志 (GatewayLog)
    """
    db: Session = next(get_sync_db())
    try:
        # 转换 UUID 字段
        for field in ("user_id", "api_key_id", "preset_id"):
            if field in log_data:
                log_data[field] = _parse_uuid(log_data.get(field), field)

        log_entry = GatewayLog(**log_data)
        db.add(log_entry)
        db.commit()
        return f"Audit log recorded: {log_entry.id}"
    except Exception as e:
        logger.error(f"Failed to record audit log: {e}")
        db.rollback()
        raise e
    finally:
        # get_sync_db 是生成器，next() 后需要手动 close 或者依赖 finally
        # 但 next() 获取的是 yield 出的值，yield 后的 finally 块要在 generator close 时执行
        # 直接调用 db.close() 更安全
        db.close()
