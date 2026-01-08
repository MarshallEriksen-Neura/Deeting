import time
from typing import Any

from app.core.celery_app import celery_app
from app.core.logging import logger


@celery_app.task(name="app.tasks.reports.generate_report")
def generate_report_task(report_type: str, parameters: dict[str, Any]):
    """
    报表生成任务
    """
    logger.info(f"Generating {report_type} report")
    # 模拟耗时操作
    time.sleep(2.0)
    logger.info(f"Report {report_type} generated")
    return {"status": "generated", "path": f"/tmp/{report_type}_report.pdf"}
