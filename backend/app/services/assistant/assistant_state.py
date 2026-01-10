"""
助手状态机：集中管理可见性与发布状态的迁移规则。
"""

from __future__ import annotations

from datetime import datetime

from app.models.assistant import Assistant, AssistantStatus
from app.utils.time_utils import Datetime

# 允许的状态迁移图
ALLOWED_TRANSITIONS: dict[AssistantStatus, set[AssistantStatus]] = {
    AssistantStatus.DRAFT: {AssistantStatus.PUBLISHED, AssistantStatus.ARCHIVED},
    AssistantStatus.PUBLISHED: {AssistantStatus.ARCHIVED},
    AssistantStatus.ARCHIVED: set(),
}


def _normalize(status: AssistantStatus | str) -> AssistantStatus:
    return status if isinstance(status, AssistantStatus) else AssistantStatus(status)


class AssistantStateMachine:
    @staticmethod
    def validate_transition(current: AssistantStatus | str, target: AssistantStatus | str) -> None:
        """
        校验状态迁移是否允许；允许幂等（current == target）。
        """
        current_enum = _normalize(current)
        target_enum = _normalize(target)
        if current_enum == target_enum:
            return
        allowed = ALLOWED_TRANSITIONS.get(current_enum, set())
        if target_enum not in allowed:
            raise ValueError(f"助手状态不允许从 {current_enum} 迁移到 {target_enum}")

    @staticmethod
    def apply(
        assistant: Assistant,
        target: AssistantStatus | str,
        now: datetime | None = None,
    ) -> Assistant:
        """
        执行状态迁移并更新相关字段：
        - 校验迁移合法性
        - 迁移到 published 时回写 published_at
        - 其他迁移不修改 published_at
        """
        current_enum = _normalize(assistant.status)
        target_enum = _normalize(target)

        AssistantStateMachine.validate_transition(current_enum, target_enum)
        if current_enum == target_enum:
            return assistant

        assistant.status = target_enum.value
        if target_enum == AssistantStatus.PUBLISHED:
            assistant.published_at = now or Datetime.now()
        return assistant
