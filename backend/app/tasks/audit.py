import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.db_sync import get_sync_db
from app.core.logging import logger
from app.models.gateway_log import GatewayLog


@celery_app.task(name="app.tasks.audit.record_audit_log")
def record_audit_log_task(log_data: dict[str, Any]) -> str:
    """
    异步记录审计日志 (GatewayLog)
    """
    db: Session = next(get_sync_db())
    try:
        # 转换 UUID 字段
        if log_data.get("user_id") and isinstance(log_data["user_id"], str):
            log_data["user_id"] = uuid.UUID(log_data["user_id"])
        if log_data.get("preset_id") and isinstance(log_data["preset_id"], str):
            log_data["preset_id"] = uuid.UUID(log_data["preset_id"])

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
