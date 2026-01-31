import uuid

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_account"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True, comment="邮箱（登录名）")
    username: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="展示名")
    avatar_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True, comment="头像对象存储 key")
    avatar_storage_type: Mapped[str] = mapped_column(String(20), nullable=False, default="public", server_default="public", comment="头像存储类型: public/private")
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False, comment="哈希密码（无密码登录使用随机占位）")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", comment="是否启用")
    is_superuser: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false", comment="是否超级管理员")
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="Token 版本号，密码修改或强制登出时递增")

    identities: Mapped[list["Identity"]] = relationship(
        "Identity",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    roles: Mapped[list["Role"]] = relationship(
        "Role",
        secondary="user_role",
        back_populates="users",
        cascade="all",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<User(email={self.email})>"


class Role(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "role"

    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, comment="角色名")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="描述")

    users: Mapped[list[User]] = relationship(
        "User",
        secondary="user_role",
        back_populates="roles",
    )
    permissions: Mapped[list["Permission"]] = relationship(
        "Permission",
        secondary="role_permission",
        back_populates="roles",
    )

    def __repr__(self) -> str:
        return f"<Role(name={self.name})>"


class Permission(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "permission"

    code: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, comment="权限编码")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="描述")

    roles: Mapped[list[Role]] = relationship(
        "Role",
        secondary="role_permission",
        back_populates="permissions",
    )

    def __repr__(self) -> str:
        return f"<Permission(code={self.code})>"


class UserRole(Base):
    __tablename__ = "user_role"
    __table_args__ = (
        UniqueConstraint("user_id", "role_id", name="uq_user_role"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(SA_UUID(as_uuid=True), ForeignKey("user_account.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[uuid.UUID] = mapped_column(SA_UUID(as_uuid=True), ForeignKey("role.id", ondelete="CASCADE"), primary_key=True)


class RolePermission(Base):
    __tablename__ = "role_permission"
    __table_args__ = (
        UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),
    )

    role_id: Mapped[uuid.UUID] = mapped_column(SA_UUID(as_uuid=True), ForeignKey("role.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[uuid.UUID] = mapped_column(SA_UUID(as_uuid=True), ForeignKey("permission.id", ondelete="CASCADE"), primary_key=True)
