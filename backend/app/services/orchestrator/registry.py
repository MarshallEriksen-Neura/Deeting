"""
StepRegistry: 步骤注册表

集中管理所有可用步骤，支持按名称查找和实例化。
禁止在路由里用 if/else 手写分支，统一通过注册表获取步骤。
"""

import logging
from typing import TypeVar

from app.services.workflow.steps.base import BaseStep, StepConfig

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseStep)


class StepNotFoundError(Exception):
    """步骤未找到异常"""

    def __init__(self, step_name: str):
        self.step_name = step_name
        super().__init__(f"Step '{step_name}' not found in registry")


class StepRegistry:
    """
    步骤注册表

    使用方式:
    1. 定义步骤类并继承 BaseStep
    2. 使用 @registry.register 装饰器注册
    3. 通过 registry.get() 获取步骤实例

    示例:
        registry = StepRegistry()

        @registry.register
        class ValidationStep(BaseStep):
            name = "validation"
            ...

        step = registry.get("validation")
    """

    _instance: "StepRegistry | None" = None

    def __new__(cls) -> "StepRegistry":
        """单例模式"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._steps = {}
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._steps: dict[str, type[BaseStep]] = {}
        self._initialized = True

    def register(self, step_class: type[T]) -> type[T]:
        """
        注册步骤类（装饰器）

        Args:
            step_class: 步骤类

        Returns:
            原步骤类（支持装饰器链）

        Raises:
            ValueError: 步骤名称重复或未定义
        """
        if not hasattr(step_class, "name") or not step_class.name:
            raise ValueError(
                f"Step class {step_class.__name__} must define 'name' attribute"
            )

        name = step_class.name
        if name in self._steps:
            raise ValueError(
                f"Step '{name}' already registered by {self._steps[name].__name__}"
            )

        self._steps[name] = step_class
        logger.debug(f"Registered step: {name} -> {step_class.__name__}")
        return step_class

    def get(
        self,
        name: str,
        config: StepConfig | None = None,
    ) -> BaseStep:
        """
        获取步骤实例

        Args:
            name: 步骤名称
            config: 可选的步骤配置

        Returns:
            步骤实例

        Raises:
            StepNotFoundError: 步骤未注册
        """
        if name not in self._steps:
            raise StepNotFoundError(name)

        step_class = self._steps[name]
        return step_class(config=config)

    def get_many(
        self,
        names: list[str],
        configs: dict[str, StepConfig] | None = None,
    ) -> list[BaseStep]:
        """
        批量获取步骤实例

        Args:
            names: 步骤名称列表
            configs: 步骤名称 -> 配置的映射

        Returns:
            步骤实例列表
        """
        configs = configs or {}
        return [self.get(name, configs.get(name)) for name in names]

    def has(self, name: str) -> bool:
        """检查步骤是否已注册"""
        return name in self._steps

    def list_all(self) -> list[str]:
        """列出所有已注册的步骤名称"""
        return list(self._steps.keys())

    def clear(self) -> None:
        """清空注册表（仅用于测试）"""
        self._steps.clear()

    def __contains__(self, name: str) -> bool:
        return self.has(name)

    def __len__(self) -> int:
        return len(self._steps)


# 全局注册表实例
step_registry = StepRegistry()
