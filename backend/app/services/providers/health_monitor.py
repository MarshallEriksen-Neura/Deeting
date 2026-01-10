import time
import httpx
from typing import Dict, List, Any
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.provider_instance import ProviderInstance

class HealthMonitorService:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def record_heartbeat(self, instance_id: str, latency_ms: int, status: str):
        key = f"provider:health:{instance_id}"
        await self.redis.hset(key, mapping={
            "status": status,
            "latency": latency_ms,
            "last_check": int(time.time())
        })
        
        history_key = f"provider:health:{instance_id}:history"
        # Store simple latency numbers for sparkline
        # If status is down, store 0.
        val = latency_ms if status != "down" else 0
        await self.redis.rpush(history_key, val)
        await self.redis.ltrim(history_key, -20, -1) # Keep last 20

    async def get_health_status(self, instance_id: str) -> Dict[str, Any]:
        key = f"provider:health:{instance_id}"
        data = await self.redis.hgetall(key)
        if not data:
            return {"status": "unknown", "latency": 0, "last_check": 0}
        
        return {
            "status": data.get(b"status", b"unknown").decode(),
            "latency": int(data.get(b"latency", 0)),
            "last_check": int(data.get(b"last_check", 0))
        }

    async def get_sparkline(self, instance_id: str) -> List[int]:
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
            async with httpx.AsyncClient(timeout=5.0) as client:
                # We expect 401 (Auth required) or 200 (OK). Both mean it's reachable.
                # If 404, the path is wrong, but server is up.
                resp = await client.get(url)
                latency = int((time.time() - start) * 1000)
                
                # Connection error would have raised exception.
                # 5xx means server error -> degraded.
                if resp.status_code >= 500:
                    status = "degraded"
        except Exception as e:
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
