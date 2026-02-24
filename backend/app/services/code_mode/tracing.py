from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any, Iterator
from uuid import uuid4

try:
    from opentelemetry import trace as otel_trace
except Exception:  # pragma: no cover - optional dependency
    otel_trace = None


@dataclass
class CodeModeSpan:
    name: str
    trace_id: str
    span_id: str
    parent_span_id: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    status: str = "running"
    error: str | None = None
    duration_ms: int | None = None
    _started: float = field(default_factory=perf_counter, repr=False)
    _otel_cm: Any = field(default=None, repr=False)
    _otel_span: Any = field(default=None, repr=False)

    def set_attribute(self, key: str, value: Any) -> None:
        if not key:
            return
        self.attributes[str(key)] = value
        if self._otel_span is not None:
            try:
                self._otel_span.set_attribute(str(key), value)
            except Exception:
                pass

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        if not name:
            return
        event = {"name": str(name)}
        if attributes:
            event["attributes"] = dict(attributes)
        self.events.append(event)
        if self._otel_span is not None:
            try:
                self._otel_span.add_event(str(name), attributes=attributes or {})
            except Exception:
                pass

    def record_exception(self, exc: Exception) -> None:
        if exc is None:
            return
        self.error = str(exc)
        self.status = "error"
        if self._otel_span is not None:
            try:
                self._otel_span.record_exception(exc)
            except Exception:
                pass

    def finish(self, *, status: str = "ok", error: Exception | None = None) -> None:
        if self.duration_ms is not None:
            return
        if error is not None:
            self.record_exception(error)
            self.status = "error"
        elif self.status == "running":
            self.status = status
        self.duration_ms = max(0, int((perf_counter() - self._started) * 1000))
        if self._otel_cm is not None:
            try:
                self._otel_cm.__exit__(None, None, None)
            except Exception:
                pass

    def child(
        self,
        name: str,
        *,
        attributes: dict[str, Any] | None = None,
    ):
        return start_span(
            name,
            trace_id=self.trace_id,
            parent_span_id=self.span_id,
            attributes=attributes,
        )


def begin_span(
    name: str,
    *,
    trace_id: str | None = None,
    parent_span_id: str | None = None,
    attributes: dict[str, Any] | None = None,
) -> CodeModeSpan:
    span = CodeModeSpan(
        name=str(name or "code_mode.span"),
        trace_id=str(trace_id or uuid4().hex),
        span_id=uuid4().hex[:16],
        parent_span_id=str(parent_span_id) if parent_span_id else None,
    )
    if attributes:
        for key, value in attributes.items():
            span.set_attribute(str(key), value)

    if otel_trace is not None:  # pragma: no cover - optional dependency
        try:
            tracer = otel_trace.get_tracer("deeting.code_mode")
            cm = tracer.start_as_current_span(span.name)
            otel_span = cm.__enter__()
            span._otel_cm = cm
            span._otel_span = otel_span
            otel_span.set_attribute("code_mode.trace_id", span.trace_id)
            otel_span.set_attribute("code_mode.span_id", span.span_id)
            if span.parent_span_id:
                otel_span.set_attribute("code_mode.parent_span_id", span.parent_span_id)
            for key, value in span.attributes.items():
                otel_span.set_attribute(str(key), value)
        except Exception:
            span._otel_cm = None
            span._otel_span = None

    return span


@contextmanager
def start_span(
    name: str,
    *,
    trace_id: str | None = None,
    parent_span_id: str | None = None,
    attributes: dict[str, Any] | None = None,
) -> Iterator[CodeModeSpan]:
    span = begin_span(
        name,
        trace_id=trace_id,
        parent_span_id=parent_span_id,
        attributes=attributes,
    )
    try:
        yield span
    except Exception as exc:
        span.finish(status="error", error=exc)
        raise
    else:
        span.finish(status="ok")
