from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel, Field


class PluginMetadata(BaseModel):
    """
    插件元数据 (Manifest)。
    相当于 VS Code 的 package.json 核心部分。
    """
    name: str = Field(..., description="Unique plugin identifier (e.g., 'core.crawler')")
    version: str = Field(..., description="Semantic version string")
    description: str = Field("", description="Human-readable description")
    author: Optional[str] = None
    dependencies: List[str] = Field(default_factory=list, description="Other plugins this plugin requires")


class PluginContext(ABC):
    """
    插件上下文接口。
    这是插件与宿主系统交互的唯一桥梁。插件不应直接 import app.db 等全局对象。
    """

    @property
    @abstractmethod
    def working_directory(self) -> str:
        """插件的私有工作目录"""
        pass

    @abstractmethod
    def get_logger(self, name: Optional[str] = None):
        """获取带有插件上下文的日志记录器"""
        pass

    # 这里的 Session 类型先用 Any 代替，避免循环引用，实际实现会注入 SQLAlchemy Session
    @abstractmethod
    def get_db_session(self) -> Any:
        """获取数据库会话"""
        pass

    @abstractmethod
    def get_config(self, key: str, default: Any = None) -> Any:
        """获取系统配置或插件专属配置"""
        pass


class AgentPlugin(ABC):
    """
    所有具体插件的基类。
    """

    def __init__(self):
        self._context: Optional[PluginContext] = None

    @property
    @abstractmethod
    def metadata(self) -> PluginMetadata:
        """返回插件的元数据"""
        pass

    def initialize(self, context: PluginContext) -> None:
        """
        生命周期钩子：插件激活时调用。
        类似于 VS Code 的 activate(context)。
        """
        self._context = context
        self.on_activate()

    def shutdown(self) -> None:
        """
        生命周期钩子：插件卸载或系统关闭时调用。
        类似于 VS Code 的 deactivate()。
        """
        self.on_deactivate()
        self._context = None

    @property
    def context(self) -> PluginContext:
        if not self._context:
            raise RuntimeError(f"Plugin {self.metadata.name} is not initialized")
        return self._context

    # --- 用户需要实现的方法 ---

    def on_activate(self) -> None:
        """(Optional) 插件启动时的初始化逻辑"""
        pass

    def on_deactivate(self) -> None:
        """(Optional) 插件关闭时的清理逻辑"""
        pass

    def get_tools(self) -> List[Any]:
        """
        (Optional) 返回此插件提供的工具列表。
        格式应兼容 OpenAI Tool Definition 或 LangChain Tool。
        """
        return []

    def get_resource_handlers(self) -> Dict[str, Any]:
        """
        (Optional) 返回资源处理器（后续扩展用）
        """
        return {}
