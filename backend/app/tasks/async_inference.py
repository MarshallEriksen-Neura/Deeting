import time
from typing import Any

from app.core.celery_app import celery_app
from app.core.logging import logger


@celery_app.task(name="app.tasks.async_inference.batch_inference", bind=True)
def batch_inference_task(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    异步批量推理任务
    """
    logger.info(f"Starting batch inference for {len(requests)} requests")
    results = []

    try:
        # 模拟推理处理
        # TODO: 集成实际的 LLM 推理逻辑或调用外部模型服务
        for req in requests:
            # 模拟耗时
            time.sleep(0.1)
            results.append({
                "id": req.get("id"),
                "status": "completed",
                "result": f"Processed: {req.get('prompt', '')[:20]}..."
            })

        logger.info("Batch inference completed")
        return results

    except Exception as e:
        logger.error(f"Batch inference failed: {e}")
        # 由于我们配置了 retry_backoff，这里抛出异常会触发重试
        raise self.retry(exc=e)
