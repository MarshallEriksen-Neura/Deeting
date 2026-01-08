"""
Request validation middleware to detect and block malicious requests.
"""

import re
import time
from collections.abc import Callable
from re import Pattern
from urllib.parse import unquote_plus

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

try:
    from redis.asyncio import Redis
except ModuleNotFoundError:
    Redis = object  # type: ignore[misc,assignment]

from app.utils.xss_protection import is_xss_attempt


class InMemoryBanStore:
    """简单的内存封禁存储，带过期时间。"""

    def __init__(self) -> None:
        self._banned: dict[str, float] = {}

    async def ban(self, ip: str, ttl_seconds: int) -> None:
        self._banned[ip] = time.time() + ttl_seconds

    async def is_banned(self, ip: str) -> bool:
        expire_at = self._banned.get(ip)
        if not expire_at:
            return False

        if expire_at < time.time():
            self._banned.pop(ip, None)
            return False

        return True


class RedisBanStore:
    """基于 Redis 的封禁存储，便于多实例共享。"""

    def __init__(self, redis_client: Redis) -> None:
        self.redis = redis_client

    async def ban(self, ip: str, ttl_seconds: int) -> None:
        await self.redis.setex(f"banlist:{ip}", ttl_seconds, "1")

    async def is_banned(self, ip: str) -> bool:
        return bool(await self.redis.exists(f"banlist:{ip}"))


class RequestValidatorMiddleware(BaseHTTPMiddleware):
    """
    请求验证中间件，检测并阻止恶意请求。

    防护：
    - SQL 注入攻击
    - XSS 攻击
    - 路径遍历攻击
    - 命令注入
    - 可疑 User-Agent
    """

    # SQL 注入特征模式
    SQL_INJECTION_PATTERNS: list[Pattern] = [
        re.compile(r"(\bunion\b.*\bselect\b)", re.IGNORECASE),
        re.compile(r"(\bselect\b.*\bfrom\b)", re.IGNORECASE),
        re.compile(r"(\binsert\b.*\binto\b)", re.IGNORECASE),
        re.compile(r"(\bdelete\b.*\bfrom\b)", re.IGNORECASE),
        re.compile(r"(\bdrop\b.*\btable\b)", re.IGNORECASE),
        re.compile(r"(\bupdate\b.*\bset\b)", re.IGNORECASE),
        re.compile(r"(--|#|/\*|\*/|;)", re.IGNORECASE),
        re.compile(r"(\bor\b\s+\d+\s*=\s*\d+)", re.IGNORECASE),
        re.compile(r"(\band\b\s+\d+\s*=\s*\d+)", re.IGNORECASE),
        re.compile(r"('|\")(\s*or\s*|\s*and\s*)('|\")", re.IGNORECASE),
    ]

    # 路径遍历攻击模式
    PATH_TRAVERSAL_PATTERNS: list[Pattern] = [
        re.compile(r"\.\./"),
        re.compile(r"%2e%2e/", re.IGNORECASE),
        re.compile(r"\.\.\\"),
    ]

    # 访问敏感系统路径（即便已被规范化也视为可疑）
    CRITICAL_SYSTEM_PATH_PATTERNS: list[Pattern] = [
        re.compile(r"(^|/)(etc/passwd|etc/shadow|etc/hosts)", re.IGNORECASE),
        re.compile(r"(^|/)(proc/|sys/|dev/)", re.IGNORECASE),
        re.compile(r"(^|/)(windows/|winnt/|system32)", re.IGNORECASE),
    ]

    # 命令注入模式
    COMMAND_INJECTION_PATTERNS: list[Pattern] = [
        re.compile(r"[;&|`$]"),
        re.compile(r"\$\(.*\)"),
        re.compile(r"`.*`"),
    ]

    # 可疑的扫描工具 User-Agent
    SUSPICIOUS_USER_AGENTS: list[Pattern] = [
        re.compile(r"sqlmap", re.IGNORECASE),
        re.compile(r"nikto", re.IGNORECASE),
        re.compile(r"nmap", re.IGNORECASE),
        re.compile(r"masscan", re.IGNORECASE),
        re.compile(r"acunetix", re.IGNORECASE),
        re.compile(r"nessus", re.IGNORECASE),
        re.compile(r"openvas", re.IGNORECASE),
        re.compile(r"metasploit", re.IGNORECASE),
        re.compile(r"burp", re.IGNORECASE),
        re.compile(r"w3af", re.IGNORECASE),
        re.compile(r"dirbuster", re.IGNORECASE),
        re.compile(r"gobuster", re.IGNORECASE),
        re.compile(r"wfuzz", re.IGNORECASE),
        re.compile(r"havij", re.IGNORECASE),
    ]

    def __init__(
        self,
        app: ASGIApp,
        enable_sql_injection_check: bool = True,
        enable_xss_check: bool = True,
        enable_path_traversal_check: bool = True,
        enable_command_injection_check: bool = True,
        enable_user_agent_check: bool = True,
        log_suspicious_requests: bool = True,
        inspect_body: bool = False,
        inspect_body_max_length: int | None = None,
        allowed_body_content_types: tuple[str, ...] = (
            "application/json",
            "application/x-www-form-urlencoded",
            "multipart/form-data",
            "text/plain",
        ),
        ban_ip_on_detection: bool = False,
        ban_ttl_seconds: int = 900,
        allowed_ips: set[str] | list[str] | None = None,
        allowed_path_prefixes: set[str] | list[str] | None = None,
        redis_client: Redis | None = None,
        redis_client_provider: Callable[[], Redis | None] | None = None,
        get_client_ip: Callable[[Request], str] | None = None,
    ):
        super().__init__(app)
        self.enable_sql_injection_check = enable_sql_injection_check
        self.enable_xss_check = enable_xss_check
        self.enable_path_traversal_check = enable_path_traversal_check
        self.enable_command_injection_check = enable_command_injection_check
        self.enable_user_agent_check = enable_user_agent_check
        self.log_suspicious_requests = log_suspicious_requests
        self.inspect_body = inspect_body
        self.inspect_body_max_length = inspect_body_max_length
        self.allowed_body_content_types = allowed_body_content_types
        self.ban_ip_on_detection = ban_ip_on_detection
        self.ban_ttl_seconds = ban_ttl_seconds
        self.allowed_ips = set(allowed_ips) if allowed_ips else set()
        self.allowed_path_prefixes = (
            set(allowed_path_prefixes) if allowed_path_prefixes else set()
        )
        self.redis_client_provider = redis_client_provider
        self.get_client_ip = get_client_ip or self._default_get_client_ip

        if self.ban_ip_on_detection or redis_client or redis_client_provider:
            self.ban_store = (
                RedisBanStore(redis_client)
                if redis_client
                else InMemoryBanStore()
            )
        else:
            self.ban_store = None

    def _upgrade_ban_store_if_possible(self) -> None:
        """Lazy attach Redis ban store when provider becomes available."""
        if not self.redis_client_provider:
            return
        if isinstance(self.ban_store, RedisBanStore):
            return
        redis_client = self.redis_client_provider()
        if redis_client:
            self.ban_store = RedisBanStore(redis_client)

    def _default_get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()

        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()

        if request.client:
            return request.client.host

        return "unknown"

    def _check_patterns(self, text: str, patterns: list[Pattern]) -> bool:
        """检查文本是否匹配任一正则模式"""
        if not text:
            return False
        return any(pattern.search(text) for pattern in patterns)

    def _collect_path_candidates(self, request: Request) -> set[str]:
        """
        收集用于路径遍历检测的候选字符串：
        - 规范化后的 path
        - 原始 raw_path（如果存在）
        - 各自的 URL 解码版本
        """
        candidates: set[str] = set()

        path = request.url.path or ""
        if path:
            candidates.add(path)

        raw_path = request.scope.get("raw_path")
        if isinstance(raw_path, (bytes, bytearray)):
            raw_path_str = raw_path.decode(errors="ignore")
        else:
            raw_path_str = raw_path or ""
        if raw_path_str:
            candidates.add(raw_path_str)

        decoded_candidates = {unquote_plus(p) for p in candidates}
        candidates.update(decoded_candidates)

        return {c for c in candidates if c}

    def _collect_query_candidates(self, request: Request) -> set[str]:
        """
        收集用于 Query 检测的候选字符串：
        - query 参数的 key / value
        - 各自的 URL 解码版本（处理 %xx 与 + 空格）
        """
        candidates: set[str] = set()

        for key, value in request.query_params.multi_items():
            if key:
                candidates.add(key)
                candidates.add(unquote_plus(key))
            if value:
                candidates.add(value)
                candidates.add(unquote_plus(value))

        return {c for c in candidates if c}

    async def _is_suspicious_request(
        self,
        request: Request,
        body_text: str = "",
    ) -> tuple[bool, str]:
        """
        检查请求是否可疑。

        Returns:
            (is_suspicious, reason)
        """
        if self.enable_user_agent_check:
            user_agent = request.headers.get("user-agent", "")
            if self._check_patterns(user_agent, self.SUSPICIOUS_USER_AGENTS):
                return True, "suspicious_user_agent"

        path_candidates = self._collect_path_candidates(request)
        query_candidates = self._collect_query_candidates(request)

        if self.enable_path_traversal_check:
            # 先检查路径本身
            for value in path_candidates:
                if self._check_patterns(value, self.PATH_TRAVERSAL_PATTERNS):
                    return True, "path_traversal_attempt"

            # 规范化后仍指向敏感系统路径，也视为路径遍历/探测行为
            for value in path_candidates:
                if self._check_patterns(value, self.CRITICAL_SYSTEM_PATH_PATTERNS):
                    return True, "path_traversal_attempt"

            # 再检查 query 中是否包含路径遍历
            for value in query_candidates:
                if self._check_patterns(value, self.PATH_TRAVERSAL_PATTERNS):
                    return True, "path_traversal_in_query"

            for value in query_candidates:
                if self._check_patterns(value, self.CRITICAL_SYSTEM_PATH_PATTERNS):
                    return True, "path_traversal_in_query"

        body_candidates: set[str] = set()
        if body_text:
            body_candidates.add(body_text)
            body_candidates.add(unquote_plus(body_text))
            body_candidates = {b for b in body_candidates if b}

        if self.enable_command_injection_check:
            for value in query_candidates:
                if self._check_patterns(value, self.COMMAND_INJECTION_PATTERNS):
                    return True, "command_injection_in_query"

            for value in body_candidates:
                if self._check_patterns(value, self.COMMAND_INJECTION_PATTERNS):
                    return True, "command_injection_in_body"

        if self.enable_xss_check:
            for value in query_candidates:
                if is_xss_attempt(value):
                    return True, "xss_in_query"

            for value in body_candidates:
                if is_xss_attempt(value):
                    return True, "xss_in_body"

        if self.enable_sql_injection_check:
            for value in query_candidates:
                if self._check_patterns(value, self.SQL_INJECTION_PATTERNS):
                    return True, "sql_injection_in_query"

            for value in body_candidates:
                if self._check_patterns(value, self.SQL_INJECTION_PATTERNS):
                    return True, "sql_injection_in_body"

        return False, ""

    async def _get_body_text(self, request: Request) -> tuple[str, Request | None]:
        body = await request.body()

        if (
            self.inspect_body_max_length
            and self.inspect_body_max_length > 0
            and len(body) > self.inspect_body_max_length
        ):
            return "__payload_too_large__", None

        # 只检查文本类型的请求体
        content_type = request.headers.get("content-type", "").lower()
        if not any(ct in content_type for ct in ["application/json", "application/x-www-form-urlencoded", "text/"]):
            return "", None

        async def receive() -> dict[str, bytes | bool]:
            return {"type": "http.request", "body": body, "more_body": False}

        refreshed_request = Request(request.scope, receive=receive)
        body_text = body.decode(errors="ignore")
        return body_text, refreshed_request

    async def dispatch(self, request: Request, call_next):
        client_ip = self.get_client_ip(request)
        path = request.url.path

        # 尝试在运行时切换到 Redis 封禁存储（在启动后才完成 Redis 初始化的场景）
        self._upgrade_ban_store_if_possible()

        # 白名单 IP / 路径前缀直接放行
        if (self.allowed_ips and client_ip in self.allowed_ips) or (
            self.allowed_path_prefixes
            and any(path.startswith(prefix) for prefix in self.allowed_path_prefixes)
        ):
            return await call_next(request)

        # 封禁 IP 直接拒绝
        if self.ban_store and await self.ban_store.is_banned(client_ip):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={
                    "error": "forbidden",
                    "message": "请求被拒绝",
                    "reason": "ip_blocked",
                },
            )

        # 检查威胁
        body_text = ""
        if self.inspect_body:
            body_text, refreshed_request = await self._get_body_text(request)
            if refreshed_request:
                request = refreshed_request

        is_threat, threat_reason = await self._is_suspicious_request(request, body_text)

        if is_threat:
            if self.log_suspicious_requests:
                from app.logging_config import logger

                logger.warning(
                    "Suspicious request blocked: %s %s from %s, reason: %s",
                    request.method,
                    request.url.path,
                    client_ip,
                    threat_reason,
                )

            # 如果需要封禁 IP
            if self.ban_store and self.ban_ip_on_detection:
                await self.ban_store.ban(client_ip, self.ban_ttl_seconds)

            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={
                    "error": "forbidden",
                    "message": "请求被拒绝",
                    "reason": threat_reason,
                },
            )

        response = await call_next(request)
        return response
