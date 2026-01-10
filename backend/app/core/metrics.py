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


def record_request(path: str, method: str, status: int, duration_seconds: float) -> None:
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


def metrics_content() -> bytes:
    """导出 Prometheus 指标"""
    return generate_latest(registry)


class RequestTimer:
    """便捷计时器"""

    def __init__(self) -> None:
        self.start = time.perf_counter()

    def seconds(self) -> float:
        return time.perf_counter() - self.start
