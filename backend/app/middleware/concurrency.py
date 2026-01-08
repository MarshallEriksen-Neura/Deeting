import asyncio

from fastapi import Request, Response

from app.core.config import settings
from app.schemas.gateway import GatewayError

# 进程内并发信号量
_semaphore = asyncio.Semaphore(settings.GATEWAY_MAX_CONCURRENCY)


async def concurrency_middleware(request: Request, call_next):
    """
    网关入口并发/背压控制
    - 超过并发且在队列等待超时时返回 503
    """
    try:
        await asyncio.wait_for(_semaphore.acquire(), timeout=settings.GATEWAY_QUEUE_TIMEOUT)
    except TimeoutError:
        return Response(
            content=GatewayError(
                code="GATEWAY_OVERLOADED",
                message="Gateway overloaded, please retry later",
                source="gateway",
                trace_id=getattr(request.state, "trace_id", None),
            ).model_dump_json(),
            status_code=503,
            media_type="application/json",
        )

    try:
        response: Response = await call_next(request)
        return response
    finally:
        _semaphore.release()
