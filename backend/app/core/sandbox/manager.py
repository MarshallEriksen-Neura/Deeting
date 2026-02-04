import asyncio
import logging
from datetime import datetime, timedelta
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
        self._cleanup_task: Optional[asyncio.Task] = None
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
            sandbox_id = sid_bytes.decode() if isinstance(sid_bytes, bytes) else sid_bytes

            if not await redis.exists(key_ref(sandbox_id)):
                logger.info("Reaping expired sandbox: %s", sandbox_id)
                try:
                    await service.kill_sandbox(sandbox_id)
                except Exception as exc:
                    logger.warning(
                        "Failed to kill zombie %s (maybe already gone): %s", sandbox_id, exc
                    )
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
            sandbox_id = await cache.get(key_session(session_id))
            if sandbox_id:
                sandbox = await self._connect_sandbox(sandbox_id)
            else:
                sandbox = await self._create_sandbox(session_id)
                sandbox_id = sandbox.id

            redis = self._get_redis()
            if redis:
                ttl = int(self.default_timeout.total_seconds())
                await cache.set(key_session(session_id), sandbox_id, ttl=ttl)
                await cache.set(key_ref(sandbox_id), "1", ttl=ttl)

            try:
                await sandbox.renew(self.default_timeout)
            except Exception:
                pass

            interpreter = await CodeInterpreter.create(sandbox)
            lang = SupportedLanguage.PYTHON
            if language and language.lower() != "python":
                return {"error": f"Unsupported language: {language}"}

            result = await interpreter.codes.run(code, language=lang)
            return {
                "result": [r.text for r in result.result] if result.result else [],
                "stdout": [l.text for l in result.logs.stdout] if result.logs.stdout else [],
                "stderr": [l.text for l in result.logs.stderr] if result.logs.stderr else [],
                "exit_code": 0,
            }
        except ResourceWarning as exc:
            return {"error": str(exc)}
        except Exception as exc:
            logger.error("Sandbox run error: %s", exc, exc_info=True)
            return {"error": "Sandbox execution failed"}
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
            spec=SandboxImageSpec(image="opensandbox/code-interpreter:v1.0.1"),
            entrypoint=["/opt/opensandbox/code-interpreter.sh"],
            env={"PYTHON_VERSION": "3.11"},
            metadata={"session_id": session_id},
            timeout=self.default_timeout,
            resource={"cpu": "1", "memory": "512Mi"},
            network_policy=None,
            extensions={},
        )

        if redis:
            await redis.sadd(KEY_ACTIVE_SET, response.id)

        return await self._connect_sandbox(response.id, factory, service, wait_ready=True)

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

        execd_endpoint = await service.get_sandbox_endpoint(sandbox_id, DEFAULT_EXECD_PORT)
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
            await sandbox.check_ready(timedelta(seconds=60), timedelta(milliseconds=500))
        return sandbox

    def _resolve_endpoint(self, original_endpoint: str) -> str:
        if ":" not in original_endpoint:
            return original_endpoint
        internal_host = original_endpoint.split(":")[0]
        if internal_host.startswith("10.") or internal_host.startswith("172.") or internal_host == "localhost":
            public_url = urlparse(self.url)
            public_host = public_url.hostname or self.url
            if internal_host != public_host:
                return original_endpoint.replace(internal_host, public_host, 1)
        return original_endpoint


sandbox_manager = SandboxManager.get_instance()
