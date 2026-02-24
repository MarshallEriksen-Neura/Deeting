import asyncio
import json
import logging
import shlex
from datetime import timedelta
from typing import Any, Optional
from urllib.parse import urlparse

from code_interpreter import CodeInterpreter, SupportedLanguage
from opensandbox import Sandbox
from opensandbox.adapters.factory import AdapterFactory
from opensandbox.config import ConnectionConfig
from opensandbox.constants import DEFAULT_EXECD_PORT
from opensandbox.models.sandboxes import SandboxImageSpec

from app.core.cache import cache
from app.core.config import settings

logger = logging.getLogger(__name__)

# Redis Keys
KEY_PREFIX = "sandbox"
KEY_ACTIVE_SET = f"{KEY_PREFIX}:active_ids"

_ERROR_CODE_TIMEOUT = "SANDBOX_TIMEOUT"
_ERROR_CODE_NETWORK_DISCONNECT = "SANDBOX_NETWORK_DISCONNECT"
_ERROR_CODE_NETWORK = "SANDBOX_NETWORK_ERROR"
_ERROR_CODE_INTERNAL = "SANDBOX_INTERNAL_ERROR"
_ERROR_CODE_RESOURCE_LIMIT = "SANDBOX_RESOURCE_LIMIT"
_ERROR_CODE_UNKNOWN = "SANDBOX_EXECUTION_ERROR"


def key_session(session_id: str) -> str:
    return f"{KEY_PREFIX}:sess:{session_id}"


def key_ref(sandbox_id: str) -> str:
    return f"{KEY_PREFIX}:ref:{sandbox_id}"


class SandboxManager:
    """
    Production-Grade Sandbox Manager.
    - Stateless (Redis-backed)
    - Global Concurrency Limit
    - Auto-Cleanup (Reaper)
    - NAT Rewrite for Hybrid Cloud
    """

    _instance: Optional["SandboxManager"] = None

    def __init__(self, default_timeout_mins: int = 30, max_sandboxes: int = 50):
        self.url = settings.OPENSANDBOX_URL
        self.default_timeout = timedelta(minutes=default_timeout_mins)
        self.max_sandboxes = max_sandboxes
        self._cleanup_task: asyncio.Task | None = None
        logger.info("SandboxManager initialized (Redis-backed). Max: %s", max_sandboxes)

    @classmethod
    def get_instance(cls) -> "SandboxManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def start_background_worker(self):
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            logger.info("SandboxManager reaper task started.")

    async def stop_background_worker(self):
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None

    async def _cleanup_loop(self):
        """Reaper: Removes zombie sandboxes whose Redis keys have expired."""
        while True:
            try:
                await asyncio.sleep(60)
                await self.reap_zombies()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Sandbox reaper error: %s", exc)

    def _get_redis(self):
        try:
            return cache.redis
        except RuntimeError:
            return None

    async def reap_zombies(self):
        """Check all active IDs. If their ref key is gone, kill them."""
        redis = self._get_redis()
        if not redis:
            return

        active_ids = await redis.smembers(KEY_ACTIVE_SET)
        if not active_ids:
            return

        config = ConnectionConfig(domain=self.url, request_timeout=timedelta(minutes=5))
        factory = AdapterFactory(config)
        service = factory.create_sandbox_service()

        for sid_bytes in active_ids:
            sandbox_id = (
                sid_bytes.decode() if isinstance(sid_bytes, bytes) else sid_bytes
            )

            if not await redis.exists(key_ref(sandbox_id)):
                logger.info("Reaping expired sandbox: %s", sandbox_id)
                try:
                    await service.kill_sandbox(sandbox_id)
                except Exception as exc:
                    logger.warning(
                        "Failed to kill zombie %s (maybe already gone): %s",
                        sandbox_id,
                        exc,
                    )
                await redis.srem(KEY_ACTIVE_SET, sandbox_id)

    async def get_or_create_sandbox(self, session_id: str) -> Sandbox:
        """
        Retrieves an existing sandbox for the session or creates a new one.
        Handles TTL renewal and resource limits.
        """
        sandbox_id = await cache.get(key_session(session_id))
        if sandbox_id:
            try:
                sandbox = await self._connect_sandbox(sandbox_id)
                # Renew TTL
                redis = self._get_redis()
                if redis:
                    ttl = int(self.default_timeout.total_seconds())
                    await cache.set(key_session(session_id), sandbox_id, ttl=ttl)
                    await cache.set(key_ref(sandbox_id), "1", ttl=ttl)
                try:
                    await sandbox.renew(self.default_timeout)
                except Exception:
                    pass
                return sandbox
            except Exception as exc:
                if self._is_sandbox_not_found(exc):
                    logger.info(
                        "Sandbox %s not found for session %s, clearing stale cache mapping.",
                        sandbox_id,
                        session_id,
                    )
                    await self._clear_stale_sandbox_mapping(session_id, sandbox_id)
                else:
                    logger.warning(
                        "Failed to reuse sandbox %s for session %s: %s",
                        sandbox_id,
                        session_id,
                        exc,
                    )

        # Create new if none exists or connection failed
        sandbox = await self._create_sandbox(session_id)
        sandbox_id = sandbox.id

        redis = self._get_redis()
        if redis:
            ttl = int(self.default_timeout.total_seconds())
            await cache.set(key_session(session_id), sandbox_id, ttl=ttl)
            await cache.set(key_ref(sandbox_id), "1", ttl=ttl)

        return sandbox

    async def _clear_stale_sandbox_mapping(
        self, session_id: str, sandbox_id: str
    ) -> None:
        await cache.delete(key_session(session_id))
        await cache.delete(key_ref(sandbox_id))
        redis = self._get_redis()
        if redis:
            await redis.srem(KEY_ACTIVE_SET, sandbox_id)

    async def stop_sandbox(self, sandbox_id: str, session_id: str | None = None):
        """Explicitly kill and remove a sandbox from management."""
        if session_id:
            await cache.delete(key_session(session_id))
        await cache.delete(key_ref(sandbox_id))

        config = ConnectionConfig(domain=self.url, request_timeout=timedelta(minutes=5))
        factory = AdapterFactory(config)
        service = factory.create_sandbox_service()
        try:
            await service.kill_sandbox(sandbox_id)
            logger.info("Explicitly killed sandbox: %s", sandbox_id)
        except Exception as exc:
            logger.warning("Failed to kill sandbox %s: %s", sandbox_id, exc)

        redis = self._get_redis()
        if redis:
            await redis.srem(KEY_ACTIVE_SET, sandbox_id)

    async def run_code(
        self,
        session_id: str,
        code: str,
        language: str = "python",
        execution_timeout: int = 30,
    ) -> dict[str, Any]:
        """
        Execute code. Handles lifecycle:
        - Check Redis for existing sandbox.
        - If missing, create new (with limit check).
        - Connect, Execute, Renew, Close.
        """
        sandbox = None
        try:
            sandbox = await self.get_or_create_sandbox(session_id)

            interpreter = await CodeInterpreter.create(sandbox)
            lang = SupportedLanguage.PYTHON
            if language and language.lower() != "python":
                return {"error": f"Unsupported language: {language}"}

            result = await interpreter.codes.run(code, language=lang)
            return {
                "result": [r.text for r in result.result] if result.result else [],
                "stdout": (
                    [l.text for l in result.logs.stdout] if result.logs.stdout else []
                ),
                "stderr": (
                    [l.text for l in result.logs.stderr] if result.logs.stderr else []
                ),
                "exit_code": 0,
            }
        except ResourceWarning as exc:
            detail = str(exc)
            return {
                "error": f"[{_ERROR_CODE_RESOURCE_LIMIT}] {detail}",
                "error_code": _ERROR_CODE_RESOURCE_LIMIT,
                "error_detail": detail,
            }
        except Exception as exc:
            error_payload = self._build_error_payload(exc)
            logger.error(
                "Sandbox run error [%s]: %s",
                error_payload["error_code"],
                error_payload["error_detail"],
                exc_info=True,
            )
            return error_payload
        finally:
            if sandbox:
                await sandbox.close()

    async def _create_sandbox(self, session_id: str) -> Sandbox:
        redis = self._get_redis()
        if redis:
            count = await redis.scard(KEY_ACTIVE_SET)
            if count >= self.max_sandboxes:
                await self.reap_zombies()
                count = await redis.scard(KEY_ACTIVE_SET)
                if count >= self.max_sandboxes:
                    raise ResourceWarning("Global sandbox limit reached. Please wait.")

        config = ConnectionConfig(domain=self.url, request_timeout=timedelta(minutes=5))
        factory = AdapterFactory(config)
        service = factory.create_sandbox_service()

        response = await service.create_sandbox(
            spec=SandboxImageSpec(image=settings.OPENSANDBOX_IMAGE),
            entrypoint=_build_sandbox_entrypoint(settings.OPENSANDBOX_ENTRYPOINT),
            env={"PYTHON_VERSION": settings.OPENSANDBOX_PYTHON_VERSION},
            metadata={"session_id": session_id},
            timeout=self.default_timeout,
            resource={
                "cpu": settings.OPENSANDBOX_RESOURCE_CPU,
                "memory": settings.OPENSANDBOX_RESOURCE_MEMORY,
            },
            network_policy=self._build_network_policy(),
            extensions={},
        )

        if redis:
            await redis.sadd(KEY_ACTIVE_SET, response.id)

        return await self._connect_sandbox(
            response.id, factory, service, wait_ready=True
        )

    def _build_network_policy(self) -> dict[str, Any] | None:
        raw = settings.OPENSANDBOX_NETWORK_POLICY_JSON
        if raw is None:
            return None
        raw = str(raw).strip()
        if not raw:
            return None

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(
                "Invalid OPENSANDBOX_NETWORK_POLICY_JSON, fallback to None: %s",
                raw,
            )
            return None

        if not isinstance(parsed, dict):
            logger.warning(
                "OPENSANDBOX_NETWORK_POLICY_JSON must decode to object, got %s; fallback to None",
                type(parsed).__name__,
            )
            return None
        return parsed

    async def _connect_sandbox(
        self,
        sandbox_id: str,
        factory: AdapterFactory | None = None,
        service=None,
        wait_ready: bool = False,
    ) -> Sandbox:
        config = ConnectionConfig(domain=self.url, request_timeout=timedelta(minutes=5))
        if not factory:
            factory = AdapterFactory(config)
        if not service:
            service = factory.create_sandbox_service()

        execd_endpoint = await service.get_sandbox_endpoint(
            sandbox_id, DEFAULT_EXECD_PORT
        )
        execd_endpoint.endpoint = self._resolve_endpoint(execd_endpoint.endpoint)

        sandbox = Sandbox(
            sandbox_id=sandbox_id,
            sandbox_service=service,
            filesystem_service=factory.create_filesystem_service(execd_endpoint),
            command_service=factory.create_command_service(execd_endpoint),
            health_service=factory.create_health_service(execd_endpoint),
            metrics_service=factory.create_metrics_service(execd_endpoint),
            connection_config=config,
        )

        if wait_ready:
            await sandbox.check_ready(
                timedelta(seconds=60), timedelta(milliseconds=500)
            )
        return sandbox

    def _resolve_endpoint(self, original_endpoint: str) -> str:
        if ":" not in original_endpoint:
            return original_endpoint
        internal_host = original_endpoint.split(":")[0]
        if (
            internal_host.startswith("10.")
            or internal_host.startswith("172.")
            or internal_host == "localhost"
        ):
            public_url = urlparse(self.url)
            public_host = public_url.hostname or self.url
            if internal_host != public_host:
                return original_endpoint.replace(internal_host, public_host, 1)
        return original_endpoint

    def _build_error_payload(self, exc: Exception) -> dict[str, str]:
        error_code, summary = self._classify_exception(exc)
        detail = self._format_exception_chain(exc)
        return {
            "error": f"[{error_code}] {summary} detail={detail}",
            "error_code": error_code,
            "error_detail": detail,
        }

    def _classify_exception(self, exc: Exception) -> tuple[str, str]:
        chain = list(self._iter_exception_chain(exc))

        for item in chain:
            msg = str(item).lower()
            name = item.__class__.__name__.lower()
            if isinstance(item, TimeoutError) or "timeout" in name or "timed out" in msg:
                return _ERROR_CODE_TIMEOUT, "沙箱请求超时"

        for item in chain:
            msg = str(item).lower()
            name = item.__class__.__name__.lower()
            if (
                "remoteprotocolerror" in name
                or "peer closed connection" in msg
                or "incomplete chunked read" in msg
                or "server disconnected" in msg
            ):
                return _ERROR_CODE_NETWORK_DISCONNECT, "沙箱连接在响应传输过程中中断"

        for item in chain:
            msg = str(item).lower()
            name = item.__class__.__name__.lower()
            if (
                "connecterror" in name
                or "readerror" in name
                or "writeerror" in name
                or "connection reset" in msg
                or "connection aborted" in msg
                or "connection refused" in msg
                or "broken pipe" in msg
                or "network is unreachable" in msg
                or "temporary failure in name resolution" in msg
            ):
                return _ERROR_CODE_NETWORK, "访问沙箱服务时发生网络错误"

        for item in chain:
            module = item.__class__.__module__.lower()
            name = item.__class__.__name__.lower()
            if name == "sandboxinternalexception" or module.startswith(
                "opensandbox.exceptions"
            ):
                return _ERROR_CODE_INTERNAL, "沙箱服务内部异常"

        return _ERROR_CODE_UNKNOWN, "沙箱执行失败"

    def _is_sandbox_not_found(self, exc: BaseException) -> bool:
        for item in self._iter_exception_chain(exc):
            message = str(item).lower()
            if "sandbox" in message and "not found" in message:
                return True
        return False

    def _iter_exception_chain(self, exc: BaseException):
        seen: set[int] = set()
        current: BaseException | None = exc
        while current and id(current) not in seen:
            seen.add(id(current))
            yield current
            current = current.__cause__ or current.__context__

    def _format_exception_chain(
        self, exc: BaseException, max_len: int = 400
    ) -> str:
        parts: list[str] = []
        for item in self._iter_exception_chain(exc):
            text = str(item).strip().replace("\n", " ")
            if text:
                parts.append(f"{item.__class__.__name__}: {text}")
            else:
                parts.append(item.__class__.__name__)
        detail = " <- ".join(parts)
        if len(detail) > max_len:
            return f"{detail[: max_len - 3]}..."
        return detail


def _build_sandbox_entrypoint(configured_entrypoint: str) -> list[str]:
    """
    Normalize shell path before launching sandbox entrypoint.

    Some runtime images only provide `/bin/bash` or `/bin/sh`, while execd
    may invoke `/usr/bin/bash`. We best-effort create `/usr/bin/bash` symlink
    to improve compatibility.
    """
    entrypoint = str(configured_entrypoint or "").strip()
    if not entrypoint:
        entrypoint = "/opt/opensandbox/code-interpreter.sh"

    quoted_entrypoint = shlex.quote(entrypoint)
    script = (
        'if [ ! -x /usr/bin/bash ]; then '
        'BASH_TARGET=""; '
        'if [ -x /bin/bash ]; then BASH_TARGET="/bin/bash"; '
        'elif [ -x /bin/sh ]; then BASH_TARGET="/bin/sh"; fi; '
        'if [ -n "$BASH_TARGET" ]; then '
        "mkdir -p /usr/bin >/dev/null 2>&1 || true; "
        'ln -sf "$BASH_TARGET" /usr/bin/bash >/dev/null 2>&1 || true; '
        "fi; "
        "fi; "
        f"exec {quoted_entrypoint}"
    )
    return ["/bin/sh", "-lc", script]


sandbox_manager = SandboxManager.get_instance()
