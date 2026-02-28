from abc import ABC, abstractmethod
from typing import Any

from app.models.skill_registry import SkillRegistry


class RuntimeContext:
    """
    Holds context dependencies for runtime execution (e.g. sandbox manager, session info).
    """

    def __init__(
        self,
        session_id: str | None,
        user_id: str | None = None,
        sandbox_manager: Any = None,
        intent: str | None = None,
        kill_on_exit: bool = False,
        trace_id: str | None = None,
    ):
        self.session_id = session_id
        self.user_id = user_id
        self.sandbox_manager = sandbox_manager
        self.intent = intent
        self.kill_on_exit = kill_on_exit
        self.trace_id = trace_id


class BaseRuntimeStrategy(ABC):
    @abstractmethod
    async def execute(
        self,
        skill: SkillRegistry,
        inputs: dict[str, Any],
        context: RuntimeContext,
    ) -> dict[str, Any]:
        """
        Execute the skill using the specific runtime strategy.
        """
        pass
