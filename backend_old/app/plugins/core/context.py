import os
import logging
from typing import Any, Optional

from app.db.session import SessionLocal
from app.logging_config import logger as root_logger
from app.plugins.core.interfaces import PluginContext
from app.settings import settings

class ConcretePluginContext(PluginContext):
    """
    PluginContext 的具体实现。
    它将 Backend 的实际基础设施（SQLAlchemy, Logging, Env）桥接给插件。
    """

    def __init__(self, plugin_name: str):
        self._plugin_name = plugin_name
        self._logger = root_logger.getChild(f"plugin.{plugin_name}")

    @property
    def working_directory(self) -> str:
        # 假设每个插件有一个临时工作目录
        path = os.path.join("/tmp/agent_plugins", self._plugin_name)
        os.makedirs(path, exist_ok=True)
        return path

    def get_logger(self, name: Optional[str] = None):
        if name:
            return self._logger.getChild(name)
        return self._logger

    def get_db_session(self) -> Any:
        # 插件必须负责关闭这个 session，或者我们通过 context manager 封装
        # 为了简单起见，这里直接返回新的 session
        return SessionLocal()

    def get_config(self, key: str, default: Any = None) -> Any:
        # 优先查找环境变量或 settings
        # 这里简单代理给系统的 settings 对象
        return getattr(settings, key, default)
