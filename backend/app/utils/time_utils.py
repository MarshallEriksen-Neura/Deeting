from datetime import UTC, datetime


class Datetime:
    """
    统一的时间处理工具类
    核心原则：
    1. 系统内部（数据库、逻辑处理）统一使用 UTC 时区
    2. 所有 datetime 对象必须带有时区信息 (Timezone-aware)
    """

    @staticmethod
    def now() -> datetime:
        """
        获取当前 UTC 时间（带时区信息）
        替代 datetime.now() 或 datetime.utcnow()
        """
        return datetime.now(UTC)

    @staticmethod
    def utcnow() -> datetime:
        """now() 的别名，明确语义"""
        return Datetime.now()

    @staticmethod
    def to_string(dt: datetime, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
        """
        将时间转换为字符串
        如果 dt 是 naive 的，默认视为 UTC
        """
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        # 转换为 UTC 后格式化，或者保持当前时区？
        # 通常后端日志或存储用 UTC，前端展示用本地。
        # 这里仅做格式化，不强制转换时区，但确保它是 aware 的。
        return dt.strftime(fmt)

    @staticmethod
    def from_string(date_string: str, fmt: str = "%Y-%m-%d %H:%M:%S") -> datetime:
        """
        将字符串转换为 UTC 时间
        如果字符串中不包含时区信息，默认视为 UTC
        """
        dt = datetime.strptime(date_string, fmt)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)

    @staticmethod
    def to_iso_string(dt: datetime) -> str:
        """转换为 ISO 8601 格式字符串 (e.g., 2023-01-01T12:00:00+00:00)"""
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.isoformat()

    @staticmethod
    def from_iso_string(iso_string: str) -> datetime:
        """从 ISO 8601 字符串解析"""
        dt = datetime.fromisoformat(iso_string)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)

    @staticmethod
    def from_timestamp(timestamp: float) -> datetime:
        """从时间戳转换为 UTC 时间"""
        return datetime.fromtimestamp(timestamp, tz=UTC)

    @staticmethod
    def to_timestamp(dt: datetime) -> float:
        """转换为时间戳"""
        return dt.timestamp()
