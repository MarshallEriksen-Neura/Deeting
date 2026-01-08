"""
认证相关 Pydantic Schema
"""

from pydantic import EmailStr, Field

from app.schemas.base import BaseSchema


class LoginRequest(BaseSchema):
    """登录请求"""
    email: EmailStr = Field(..., description="邮箱")
    password: str = Field(..., min_length=1, description="密码")


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


class ChangePasswordRequest(BaseSchema):
    """修改密码请求"""
    old_password: str = Field(..., min_length=1, description="旧密码")
    new_password: str = Field(..., min_length=8, max_length=128, description="新密码")


class RegisterRequest(BaseSchema):
    """注册请求"""
    email: EmailStr = Field(..., description="邮箱")
    password: str = Field(..., min_length=8, max_length=128, description="密码")
    username: str | None = Field(None, max_length=100, description="展示名")
    invite_code: str | None = Field(None, max_length=64, description="邀请码")


class ActivateRequest(BaseSchema):
    """激活账号请求"""
    email: EmailStr = Field(..., description="邮箱")
    code: str = Field(..., min_length=6, max_length=6, description="6位验证码")


class ResetPasswordRequest(BaseSchema):
    """请求密码重置"""
    email: EmailStr = Field(..., description="邮箱")


class ResetPasswordConfirmRequest(BaseSchema):
    """确认密码重置"""
    email: EmailStr = Field(..., description="邮箱")
    code: str = Field(..., min_length=6, max_length=6, description="6位验证码")
    new_password: str = Field(..., min_length=8, max_length=128, description="新密码")


class MessageResponse(BaseSchema):
    """通用消息响应"""
    message: str = Field(..., description="消息内容")
