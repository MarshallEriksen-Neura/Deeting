import logging
from types import SimpleNamespace

import app.core.logging as logging_module


class _BoundLogger:
    def __init__(self, parent, extra: dict[str, object]):
        self._parent = parent
        self._extra = extra
        self._opt_kwargs: dict[str, object] | None = None

    def opt(self, **kwargs):
        self._opt_kwargs = kwargs
        return self

    def log(self, level, message):
        self._parent.log_calls.append(
            {
                "level": level,
                "message": message,
                "extra": self._extra,
                "opt": self._opt_kwargs,
            }
        )


class _DummyLogger:
    def __init__(self):
        self.bind_calls: list[dict[str, object]] = []
        self.log_calls: list[dict[str, object]] = []
        self._opt_kwargs: dict[str, object] | None = None

    def level(self, levelname: str):
        return SimpleNamespace(name=levelname)

    def bind(self, **kwargs):
        self.bind_calls.append(kwargs)
        return _BoundLogger(self, kwargs)

    def opt(self, **kwargs):
        self._opt_kwargs = kwargs
        return self

    def log(self, level, message):
        self.log_calls.append(
            {
                "level": level,
                "message": message,
                "extra": None,
                "opt": self._opt_kwargs,
            }
        )


def test_intercept_handler_forwards_logging_extra(monkeypatch):
    dummy_logger = _DummyLogger()
    monkeypatch.setattr(logging_module, "logger", dummy_logger)
    monkeypatch.setattr(logging_module.settings, "LOG_JSON_FORMAT", False)

    handler = logging_module.InterceptHandler()
    record = logging.LogRecord(
        name="test.logger",
        level=logging.INFO,
        pathname=__file__,
        lineno=42,
        msg="event %s",
        args=("ok",),
        exc_info=None,
    )
    record.trace_id = "trace_123"
    record.code_preview = "print('hello')"

    handler.emit(record)

    assert len(dummy_logger.bind_calls) == 1
    assert dummy_logger.bind_calls[0]["trace_id"] == "trace_123"
    assert dummy_logger.bind_calls[0]["code_preview"] == "print('hello')"
    assert len(dummy_logger.log_calls) == 1
    assert dummy_logger.log_calls[0]["message"].startswith("event ok | extra=")
    assert '"trace_id": "trace_123"' in dummy_logger.log_calls[0]["message"]
    assert dummy_logger.log_calls[0]["extra"]["trace_id"] == "trace_123"


def test_intercept_handler_skips_bind_when_no_extra(monkeypatch):
    dummy_logger = _DummyLogger()
    monkeypatch.setattr(logging_module, "logger", dummy_logger)
    monkeypatch.setattr(logging_module.settings, "LOG_JSON_FORMAT", False)

    handler = logging_module.InterceptHandler()
    record = logging.LogRecord(
        name="test.logger",
        level=logging.INFO,
        pathname=__file__,
        lineno=11,
        msg="plain message",
        args=(),
        exc_info=None,
    )

    handler.emit(record)

    assert dummy_logger.bind_calls == []
    assert len(dummy_logger.log_calls) == 1
    assert dummy_logger.log_calls[0]["message"] == "plain message"
    assert dummy_logger.log_calls[0]["extra"] is None


def test_intercept_handler_keeps_plain_message_in_json_mode(monkeypatch):
    dummy_logger = _DummyLogger()
    monkeypatch.setattr(logging_module, "logger", dummy_logger)
    monkeypatch.setattr(logging_module.settings, "LOG_JSON_FORMAT", True)

    handler = logging_module.InterceptHandler()
    record = logging.LogRecord(
        name="test.logger",
        level=logging.INFO,
        pathname=__file__,
        lineno=77,
        msg="json mode",
        args=(),
        exc_info=None,
    )
    record.trace_id = "trace_json"

    handler.emit(record)

    assert len(dummy_logger.log_calls) == 1
    assert dummy_logger.log_calls[0]["message"] == "json mode"
    assert dummy_logger.log_calls[0]["extra"]["trace_id"] == "trace_json"
