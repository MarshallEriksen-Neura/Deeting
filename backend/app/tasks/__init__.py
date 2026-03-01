"""
任务包入口。

Celery autodiscover 只会加载 app.tasks 包本身，因此需要在此显式导入
各任务模块以完成注册，避免 worker 收到未注册任务。
"""

# 导入任务模块以触发 Celery 任务注册（仅用于副作用）
from . import agent  # noqa: F401
from . import apikey_sync  # noqa: F401
from . import assistant  # noqa: F401
from . import async_inference  # noqa: F401
from . import audit  # noqa: F401
from . import billing  # noqa: F401
from . import callbacks  # noqa: F401
from . import conversation  # noqa: F401
from . import document_tasks  # noqa: F401
from . import example  # noqa: F401
from . import feedback_attribution  # noqa: F401
from . import image_generation  # noqa: F401
from . import knowledge_tasks  # noqa: F401
from . import media  # noqa: F401
from . import memory_tasks  # noqa: F401
from . import monitor  # noqa: F401
from . import notification  # noqa: F401
from . import periodic  # noqa: F401
from . import quota_sync  # noqa: F401
from . import reports  # noqa: F401
from . import search_index  # noqa: F401
from . import skill_registry  # noqa: F401
from . import spec_agent_tasks  # noqa: F401
from . import spec_knowledge_tasks  # noqa: F401
from . import upstream  # noqa: F401
from . import video_generation  # noqa: F401

__all__: list[str] = []
