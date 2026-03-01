from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache


class CronExpressionError(ValueError):
    """Cron 表达式非法。"""


@dataclass(frozen=True)
class CronSpec:
    minutes: frozenset[int]
    hours: frozenset[int]
    days: frozenset[int]
    months: frozenset[int]
    weekdays: frozenset[int]

    def matches(self, dt: datetime) -> bool:
        return (
            dt.minute in self.minutes
            and dt.hour in self.hours
            and dt.day in self.days
            and dt.month in self.months
            and dt.weekday() in self.weekdays
        )


def _normalize_weekday(value: int) -> int:
    # Python weekday: Monday=0, Sunday=6
    # Cron weekday: Sunday=0 or 7, Monday=1 ... Saturday=6
    if value in (0, 7):
        return 6
    return value - 1


def _parse_token(token: str, min_value: int, max_value: int, field_name: str) -> set[int]:
    token = token.strip()
    if not token:
        raise CronExpressionError(f"{field_name} 字段为空")

    if token == "*":
        return set(range(min_value, max_value + 1))

    step = 1
    if "/" in token:
        base, step_part = token.split("/", 1)
        try:
            step = int(step_part)
        except ValueError as exc:
            raise CronExpressionError(f"{field_name} 字段步长非法: {token}") from exc
        if step <= 0:
            raise CronExpressionError(f"{field_name} 字段步长必须大于 0: {token}")
    else:
        base = token

    if base == "*":
        start, end = min_value, max_value
    elif "-" in base:
        left, right = base.split("-", 1)
        try:
            start = int(left)
            end = int(right)
        except ValueError as exc:
            raise CronExpressionError(f"{field_name} 字段范围非法: {token}") from exc
    else:
        try:
            value = int(base)
        except ValueError as exc:
            raise CronExpressionError(f"{field_name} 字段取值非法: {token}") from exc
        start, end = value, value

    if start < min_value or end > max_value or start > end:
        raise CronExpressionError(f"{field_name} 字段越界: {token}")

    return set(range(start, end + 1, step))


def _parse_field(raw: str, min_value: int, max_value: int, field_name: str) -> frozenset[int]:
    values: set[int] = set()
    for part in raw.split(","):
        values.update(_parse_token(part, min_value, max_value, field_name))
    return frozenset(values)


@lru_cache(maxsize=512)
def parse_cron_expr(expr: str) -> CronSpec:
    """
    解析标准 5 段 cron 表达式: minute hour day month weekday。
    """
    parts = expr.strip().split()
    if len(parts) != 5:
        raise CronExpressionError("Cron 表达式必须是 5 段")

    minute_raw, hour_raw, day_raw, month_raw, weekday_raw = parts
    weekdays = _parse_field(weekday_raw, 0, 7, "weekday")
    normalized_weekdays = frozenset(_normalize_weekday(v) for v in weekdays)

    return CronSpec(
        minutes=_parse_field(minute_raw, 0, 59, "minute"),
        hours=_parse_field(hour_raw, 0, 23, "hour"),
        days=_parse_field(day_raw, 1, 31, "day"),
        months=_parse_field(month_raw, 1, 12, "month"),
        weekdays=normalized_weekdays,
    )


def validate_cron_expr(expr: str) -> tuple[bool, str | None]:
    try:
        parse_cron_expr(expr)
    except CronExpressionError as exc:
        return False, str(exc)
    return True, None


def next_run_after(expr: str, after_dt: datetime) -> datetime:
    """
    计算 after_dt 之后最近一次触发时间（分钟粒度）。
    """
    spec = parse_cron_expr(expr)
    cursor = after_dt.replace(second=0, microsecond=0) + timedelta(minutes=1)
    max_cursor = cursor + timedelta(days=366)

    while cursor <= max_cursor:
        if spec.matches(cursor):
            return cursor
        cursor += timedelta(minutes=1)

    raise CronExpressionError("未在 366 天窗口内找到下一次触发时间")
