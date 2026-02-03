"""
任务包入口。

避免在包导入时提前加载所有任务模块，以免产生循环依赖；
Celery 会通过 autodiscover 自动加载任务定义。
"""

from .knowledge_tasks import index_knowledge_artifact_task
from .search_index import (
    delete_assistant_task,
    delete_mcp_tool_task,
    delete_provider_preset_task,
    rebuild_all_task,
    upsert_assistant_task,
    upsert_mcp_tool_task,
    upsert_provider_preset_task,
)

__all__ = [
    "index_knowledge_artifact_task",
    "rebuild_all_task",
    "upsert_mcp_tool_task",
    "delete_mcp_tool_task",
    "upsert_provider_preset_task",
    "delete_provider_preset_task",
    "upsert_assistant_task",
    "delete_assistant_task",
]
