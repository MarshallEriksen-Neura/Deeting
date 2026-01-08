from fastapi import HTTPException, status

from app.core.config import settings


class RegistrationPolicy:
    """
    单一注册准入策略：
    - 当 REGISTRATION_CONTROL_ENABLED 为 True 时，所有新用户必须提供邀请码
    - 当开关关闭时，允许自由注册
    备注：窗口配额与邀请码有效性由 InviteCodeService 处理，这里只做准入决策。
    """

    def ensure_can_register(self, *, invite_code: str | None, provider: str) -> None:
        # 已存在用户的情况应在调用方提前返回，这里只关心“新用户能否创建”
        if not settings.REGISTRATION_CONTROL_ENABLED:
            return

        if invite_code:
            return

        # 开启注册控制但未提供邀请码
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration requires invite code",
        )


__all__ = ["RegistrationPolicy"]
