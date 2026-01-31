"""
任务包入口。

避免在包导入时提前加载所有任务模块，以免产生循环依赖；
Celery 会通过 autodiscover 自动加载任务定义。
"""

from .knowledge_tasks import index_knowledge_artifact_task

__all__ = ["index_knowledge_artifact_task"]
