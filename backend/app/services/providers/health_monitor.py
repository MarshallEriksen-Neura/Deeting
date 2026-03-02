import time
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http_client import create_async_http_client
from app.models.provider_instance import ProviderInstance


class HealthMonitorService:
    def __init__(
        self,
        redis: Redis,
        *,
        write_throttle_seconds: int = 5,
        stale_seconds: int = 300,
    ):
        self.redis = redis
        self.write_throttle_seconds = write_throttle_seconds
        self.stale_seconds = stale_seconds

    async def record_heartbeat(
        self, instance_id: str, latency_ms: int, status: str, *, force: bool = False
    ):
        if not force and await self._should_skip_write(instance_id, status):
            return

        key = f"provider:health:{instance_id}"
        normalized_latency = max(int(latency_ms or 0), 0)
        await self.redis.hset(
            key,
            mapping={
                "status": status,
                "latency": normalized_latency,
                "last_check": int(time.time()),
            },
        )

        history_key = f"provider:health:{instance_id}:history"
        # Store simple latency numbers for sparkline
        # If status is down, store 0.
        val = normalized_latency if status != "down" else 0
        await self.redis.rpush(history_key, val)
        await self.redis.ltrim(history_key, -20, -1)  # Keep last 20

    async def record_request_result(
        self,
        instance_id: str | None,
        *,
        status_code: int | None,
        latency_ms: float | int | None,
        error_code: str | None = None,
    ) -> None:
        """
        基于真实请求结果更新 provider 健康状态。

        - 2xx/3xx/4xx 视为可达（healthy）
        - 5xx 视为 degraded
        - timeout/网络异常等无状态码错误视为 down
        """
        if not instance_id:
            return

        normalized_status_code = self._to_int(status_code)
        normalized_latency = max(int(float(latency_ms or 0)), 0)
        normalized_error = (error_code or "").strip().upper()

        if normalized_status_code >= 500:
            status = "degraded"
        elif normalized_status_code > 0:
            status = "healthy"
        elif normalized_error in {"UPSTREAM_TIMEOUT", "TIMEOUT", "UPSTREAM_ERROR"}:
            status = "down"
        else:
            status = "down"

        await self.record_heartbeat(
            str(instance_id),
            normalized_latency if status != "down" else 0,
            status,
        )

    async def get_health_status(self, instance_id: str) -> dict[str, Any]:
        key = f"provider:health:{instance_id}"
        data = await self.redis.hgetall(key)
        if not data:
            return {"status": "unknown", "latency": 0, "last_check": 0}

        # 兼容 decode_responses=False(bytes key) 与 decode_responses=True(str key)
        # 两种 Redis 客户端返回格式，避免有值时被误判为 unknown。
        status_raw = data.get(b"status")
        if status_raw is None:
            status_raw = data.get("status", "unknown")

        latency_raw = data.get(b"latency")
        if latency_raw is None:
            latency_raw = data.get("latency", 0)

        last_check_raw = data.get(b"last_check")
        if last_check_raw is None:
            last_check_raw = data.get("last_check", 0)

        status = self._to_str(status_raw).strip().lower()
        latency = max(self._to_int(latency_raw), 0)
        last_check = max(self._to_int(last_check_raw), 0)

        # 超过 stale_seconds 未更新的状态统一降级为 unknown，避免旧状态长期误导。
        if (
            self.stale_seconds > 0
            and last_check > 0
            and (int(time.time()) - last_check) > self.stale_seconds
        ):
            return {"status": "unknown", "latency": 0, "last_check": last_check}

        return {
            "status": status or "unknown",
            "latency": latency,
            "last_check": last_check,
        }

    async def get_sparkline(self, instance_id: str) -> list[int]:
        history_key = f"provider:health:{instance_id}:history"
        data = await self.redis.lrange(history_key, 0, -1)
        if not data:
            return []
        return [int(x) for x in data]

    async def check_instance(self, instance: ProviderInstance):
        url = instance.base_url.rstrip("/") + "/v1/models"
        # Special case for Ollama or others if needed
        # Assuming most support /v1/models or just ping base_url if not.

        start = time.time()
        status = "healthy"
        latency = 0
        try:
            async with create_async_http_client(timeout=5.0) as client:
                # We expect 401 (Auth required) or 200 (OK). Both mean it's reachable.
                # If 404, the path is wrong, but server is up.
                resp = await client.get(url)
                latency = int((time.time() - start) * 1000)

                # Connection error would have raised exception.
                # 5xx means server error -> degraded.
                if resp.status_code >= 500:
                    status = "degraded"
        except Exception:
            status = "down"
            latency = 0

        await self.record_heartbeat(str(instance.id), latency, status)

    async def check_all_instances(self, db: AsyncSession):
        """Batch check all enabled instances."""
        stmt = select(ProviderInstance).where(ProviderInstance.is_enabled == True)
        result = await db.execute(stmt)
        instances = result.scalars().all()
        for inst in instances:
            await self.check_instance(inst)

    async def _should_skip_write(self, instance_id: str, status: str) -> bool:
        if self.write_throttle_seconds <= 0:
            return False

        key = f"provider:health:{instance_id}"
        current_status = self._to_str(await self.redis.hget(key, "status")).strip().lower()
        current_last_check = self._to_int(await self.redis.hget(key, "last_check"))
        next_status = (status or "").strip().lower()

        # 状态变化时不节流，确保故障恢复/劣化能尽快反映。
        if not current_status or current_status != next_status:
            return False

        if current_last_check <= 0:
            return False

        return (int(time.time()) - current_last_check) < self.write_throttle_seconds

    @staticmethod
    def _to_int(value: Any) -> int:
        if isinstance(value, bytes):
            value = value.decode()
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _to_str(value: Any) -> str:
        if isinstance(value, bytes):
            return value.decode()
        if value is None:
            return ""
        return str(value)
