from fastapi import Request

from app.core.metrics import RequestTimer, record_request


async def metrics_middleware(request: Request, call_next):
    timer = RequestTimer()
    response = await call_next(request)
    duration = timer.seconds()
    try:
        record_request(
            path=request.url.path,
            method=request.method,
            status=response.status_code,
            duration_seconds=duration,
        )
    except Exception:
        # 指标失败不影响主流程
        pass
    return response
