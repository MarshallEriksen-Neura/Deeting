"""
简单 Prometheus 指标封装

目的：
- 统一记录网关请求/上游调用的 SLI（成功率、延迟、失败类型）
- Phase 8 可观察性要求的 p95/p99 由 Prometheus/Alertmanager 侧计算
"""

from __future__ import annotations

import time

from prometheus_client import CollectorRegistry, Counter, Histogram, generate_latest

# 注册表便于单元测试重置
registry = CollectorRegistry()

REQUEST_LATENCY = Histogram(
    "gateway_request_latency_seconds",
    "网关请求耗时",
    ["path", "method", "status"],
    registry=registry,
)
REQUEST_TOTAL = Counter(
    "gateway_request_total",
    "网关请求计数",
    ["path", "method", "status"],
    registry=registry,
)
UPSTREAM_LATENCY = Histogram(
    "gateway_upstream_latency_seconds",
    "上游调用耗时",
    ["provider", "model", "success"],
    registry=registry,
)
UPSTREAM_FAILURES = Counter(
    "gateway_upstream_failures_total",
    "上游失败计数",
    ["provider", "model", "error"],
    registry=registry,
)
CODE_MODE_BRIDGE_CALL_TOTAL = Counter(
    "code_mode_bridge_call_total",
    "Code Mode Bridge 调用总数",
    ["tool_name", "status", "error_code"],
    registry=registry,
)
CODE_MODE_BRIDGE_CALL_LATENCY = Histogram(
    "code_mode_bridge_call_latency_seconds",
    "Code Mode Bridge 调用耗时",
    ["tool_name", "status"],
    registry=registry,
)
CODE_MODE_EXECUTIONS_TOTAL = Counter(
    "code_mode_executions_total",
    "Code Mode 执行总数",
    ["status", "error_code"],
    registry=registry,
)
CODE_MODE_EXECUTION_DURATION_SECONDS = Histogram(
    "code_mode_execution_duration_seconds",
    "Code Mode 执行耗时",
    ["status"],
    registry=registry,
)
CODE_MODE_TOOL_CALLS_TOTAL = Counter(
    "code_mode_tool_calls_total",
    "Code Mode 运行时工具调用总数",
    ["tool_name", "status", "error_code"],
    registry=registry,
)
CODE_MODE_ERRORS_TOTAL = Counter(
    "code_mode_errors_total",
    "Code Mode 错误总数",
    ["error_code"],
    registry=registry,
)


def record_request(
    path: str, method: str, status: int, duration_seconds: float
) -> None:
    REQUEST_LATENCY.labels(path=path, method=method, status=status).observe(
        duration_seconds
    )
    REQUEST_TOTAL.labels(path=path, method=method, status=status).inc()


def record_upstream_call(
    provider: str,
    model: str,
    success: bool,
    latency_ms: float,
    error_code: str | None = None,
) -> None:
    UPSTREAM_LATENCY.labels(
        provider=provider, model=model, success=str(success)
    ).observe(latency_ms / 1000.0)
    if not success:
        UPSTREAM_FAILURES.labels(
            provider=provider,
            model=model,
            error=error_code or "unknown",
        ).inc()


def record_code_mode_bridge_call(
    *,
    tool_name: str,
    success: bool,
    duration_seconds: float,
    error_code: str | None = None,
) -> None:
    status = "success" if success else "failed"
    normalized_error = "none" if success else (error_code or "unknown")
    CODE_MODE_BRIDGE_CALL_TOTAL.labels(
        tool_name=tool_name or "unknown",
        status=status,
        error_code=normalized_error,
    ).inc()
    CODE_MODE_BRIDGE_CALL_LATENCY.labels(
        tool_name=tool_name or "unknown",
        status=status,
    ).observe(max(0.0, float(duration_seconds or 0.0)))


def record_code_mode_execution(
    *,
    status: str,
    duration_seconds: float,
    error_code: str | None = None,
) -> None:
    normalized_status = str(status or "unknown").strip().lower() or "unknown"
    normalized_error = (
        "none"
        if not error_code
        else str(error_code).strip() or "unknown"
    )
    CODE_MODE_EXECUTIONS_TOTAL.labels(
        status=normalized_status,
        error_code=normalized_error,
    ).inc()
    CODE_MODE_EXECUTION_DURATION_SECONDS.labels(status=normalized_status).observe(
        max(0.0, float(duration_seconds or 0.0))
    )
    if normalized_status != "success" or normalized_error != "none":
        CODE_MODE_ERRORS_TOTAL.labels(error_code=normalized_error).inc()


def record_code_mode_tool_call(
    *,
    tool_name: str,
    status: str,
    error_code: str | None = None,
) -> None:
    normalized_status = str(status or "unknown").strip().lower() or "unknown"
    normalized_error = (
        "none"
        if not error_code
        else str(error_code).strip() or "unknown"
    )
    CODE_MODE_TOOL_CALLS_TOTAL.labels(
        tool_name=tool_name or "unknown",
        status=normalized_status,
        error_code=normalized_error,
    ).inc()
    if normalized_status != "success":
        CODE_MODE_ERRORS_TOTAL.labels(error_code=normalized_error).inc()


def metrics_content() -> bytes:
    """导出 Prometheus 指标"""
    return generate_latest(registry)


class RequestTimer:
    """便捷计时器"""

    def __init__(self) -> None:
        self.start = time.perf_counter()

    def seconds(self) -> float:
        return time.perf_counter() - self.start
