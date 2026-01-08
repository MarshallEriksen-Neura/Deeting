"""
WorkflowContext: 编排上下文管理

贯穿整个请求生命周期，承载请求元数据、租户/Key、选路结果、计费、trace_id。
各步骤在各自命名空间读写，避免键冲突。
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession


class Channel(str, Enum):
    """通道类型"""

    INTERNAL = "internal"  # 内部通道（服务内部前端）
    EXTERNAL = "external"  # 外部通道（第三方客户端）


class ErrorSource(str, Enum):
    """错误归因来源"""

    GATEWAY = "gateway"  # 网关自身校验/限流/鉴权失败
    UPSTREAM = "upstream"  # 上游超时/5xx
    CLIENT = "client"  # 客户端取消/断开


@dataclass
class UpstreamResult:
    """上游调用结果"""

    provider: str | None = None
    model: str | None = None
    upstream_url: str | None = None
    status_code: int | None = None
    latency_ms: float | None = None
    retry_count: int = 0
    error_code: str | None = None
    error_message: str | None = None


@dataclass
class BillingInfo:
    """计费信息"""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    input_cost: float = 0.0
    output_cost: float = 0.0
    total_cost: float = 0.0
    currency: str = "USD"


@dataclass
class WorkflowContext:
    """
    编排上下文：贯穿整个请求生命周期

    设计原则：
    - 各步骤在各自命名空间读写，避免键冲突
    - 不可变元数据与可变状态分离
    - 支持序列化用于审计日志
    """

    # ===== 请求元数据（不可变）=====
    trace_id: str = field(default_factory=lambda: uuid4().hex)
    channel: Channel = Channel.INTERNAL
    created_at: datetime = field(default_factory=datetime.utcnow)

    # 租户与认证
    tenant_id: str | None = None
    api_key_id: str | None = None
    user_id: str | None = None

    # 请求信息
    capability: str | None = None  # 如 chat, embeddings, image
    requested_model: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None
    db_session: AsyncSession | None = None  # 供步骤访问数据库

    # ===== 各步骤命名空间（可变）=====
    _namespaces: dict[str, dict[str, Any]] = field(default_factory=dict)

    # ===== 路由决策结果 =====
    selected_preset_id: int | None = None
    selected_preset_item_id: int | None = None
    selected_upstream: str | None = None
    routing_weight: float | None = None

    # ===== 上游调用结果 =====
    upstream_result: UpstreamResult = field(default_factory=UpstreamResult)

    # ===== 计费信息 =====
    billing: BillingInfo = field(default_factory=BillingInfo)

    # ===== 错误与状态 =====
    error_source: ErrorSource | None = None
    error_code: str | None = None
    error_message: str | None = None
    is_success: bool = True

    # ===== 步骤执行追踪 =====
    executed_steps: list[str] = field(default_factory=list)
    step_timings: dict[str, float] = field(default_factory=dict)  # step_name -> ms

    def get(self, step_name: str, key: str, default: Any = None) -> Any:
        """
        从指定步骤的命名空间获取值

        Args:
            step_name: 步骤名称
            key: 键名
            default: 默认值

        Returns:
            存储的值或默认值
        """
        return self._namespaces.get(step_name, {}).get(key, default)

    def set(self, step_name: str, key: str, value: Any) -> None:
        """
        向指定步骤的命名空间写入值

        Args:
            step_name: 步骤名称
            key: 键名
            value: 值
        """
        if step_name not in self._namespaces:
            self._namespaces[step_name] = {}
        self._namespaces[step_name][key] = value

    def get_namespace(self, step_name: str) -> dict[str, Any]:
        """获取整个步骤命名空间"""
        return self._namespaces.get(step_name, {})

    def mark_step_executed(self, step_name: str, duration_ms: float) -> None:
        """记录步骤执行完成"""
        self.executed_steps.append(step_name)
        self.step_timings[step_name] = duration_ms

    def mark_error(
        self,
        source: ErrorSource,
        code: str,
        message: str,
        upstream_status: int | None = None,
        upstream_code: str | None = None,
    ) -> None:
        """标记错误信息"""
        self.is_success = False
        self.error_source = source
        self.error_code = code
        self.error_message = message
        if upstream_status is not None:
            self.upstream_result.status_code = upstream_status
        if upstream_code is not None:
            self.upstream_result.error_code = upstream_code

    def to_audit_dict(self) -> dict[str, Any]:
        """
        转换为审计日志格式

        脱敏处理：不包含敏感的请求/响应体
        """
        return {
            "trace_id": self.trace_id,
            "channel": self.channel.value,
            "created_at": self.created_at.isoformat(),
            "tenant_id": self.tenant_id,
            "api_key_id": self.api_key_id,
            "capability": self.capability,
            "requested_model": self.requested_model,
            "selected_upstream": self.selected_upstream,
            "upstream": {
                "provider": self.upstream_result.provider,
                "model": self.upstream_result.model,
                "status_code": self.upstream_result.status_code,
                "latency_ms": self.upstream_result.latency_ms,
                "retry_count": self.upstream_result.retry_count,
            },
            "billing": {
                "input_tokens": self.billing.input_tokens,
                "output_tokens": self.billing.output_tokens,
                "total_cost": self.billing.total_cost,
                "currency": self.billing.currency,
            },
            "is_success": self.is_success,
            "error_source": self.error_source.value if self.error_source else None,
            "error_code": self.error_code,
            "executed_steps": self.executed_steps,
            "step_timings": self.step_timings,
            "total_duration_ms": sum(self.step_timings.values()),
        }

    @property
    def is_external(self) -> bool:
        """是否为外部通道"""
        return self.channel == Channel.EXTERNAL

    @property
    def is_internal(self) -> bool:
        """是否为内部通道"""
        return self.channel == Channel.INTERNAL
