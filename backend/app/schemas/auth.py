"""认证相关 Pydantic Schema"""

from pydantic import EmailStr, Field

from app.schemas.base import BaseSchema


class SendLoginCodeRequest(BaseSchema):
    """请求登录验证码（无密码登录入口）。"""

    email: EmailStr = Field(..., description="邮箱")
    invite_code: str | None = Field(
        None,
        max_length=64,
        description="邀请码（开启注册控制时，首次登录必填）",
    )


class LoginRequest(BaseSchema):
    """验证码登录请求"""

    email: EmailStr = Field(..., description="邮箱")
    code: str = Field(..., min_length=6, max_length=6, description="6 位邮箱验证码")
    invite_code: str | None = Field(
        None,
        max_length=64,
        description="邀请码（仅新用户在受控注册时需要）",
    )
    username: str | None = Field(
        None,
        max_length=100,
        description="可选展示名，新用户首次登录时设置",
    )


class TokenPair(BaseSchema):
    """Token 对响应"""

    access_token: str = Field(..., description="访问令牌")
    refresh_token: str = Field(..., description="刷新令牌")
    token_type: str = Field("bearer", description="令牌类型")


class OAuthCallbackRequest(BaseSchema):
    """LinuxDo OAuth 回调请求"""

    code: str = Field(..., description="授权码")
    state: str | None = Field(None, description="state 参数")


class OAuthCallbackResponse(TokenPair):
    """LinuxDo OAuth 回调响应"""

    user_id: str = Field(..., description="用户 ID")
    expires_in: int = Field(..., description="访问令牌有效期（秒）")


class RefreshRequest(BaseSchema):
    """刷新 Token 请求"""

    refresh_token: str = Field(..., description="刷新令牌")


class MessageResponse(BaseSchema):
    """通用消息响应"""

    message: str = Field(..., description="消息内容")
