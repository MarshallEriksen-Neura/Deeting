
from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PublicModel(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Public Model (展示层)
    用于前端展示和逻辑路由的统一模型目录
    """
    __tablename__ = "public_model"

    # ID 直接使用字符串主键可能更方便路由引用（如 gpt-4o），
    # 但 Mixin 使用了 UUID。为了保持一致，我们增加一个 unique 的 slug/name 字段。
    # 或者重写 ID 字段。根据设计文档 "字段含 id"，这里我们保持 UUID 主键，
    # 增加 model_id 作为展示/引用 ID。

    model_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True, comment="模型唯一标识")
    display_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="展示名称")
    family: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="模型家族 (如 gpt-4, claude-3)")
    type: Mapped[str] = mapped_column(String(32), nullable=False, comment="模型类型 (如 chat, image, tts)")

    context_window: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="上下文窗口大小")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="模型描述")
    icon_url: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="图标 URL")

    input_price_display: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="输入价格展示文本")
    output_price_display: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="输出价格展示文本")

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="排序权重")
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", comment="是否公开可见")

    def __repr__(self) -> str:
        return f"<PublicModel(model_id={self.model_id}, display_name={self.display_name})>"
