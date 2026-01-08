from uuid import uuid4

from fastapi import Request, Response

from app.core.config import settings


async def trace_middleware(request: Request, call_next):
    """
    追踪 ID 中间件
    - 优先使用客户端提供的 TRACE_ID_HEADER
    - 写入 request.state.trace_id，供后续使用
    - 在响应头返回同一 trace id
    """
    trace_id = request.headers.get(settings.TRACE_ID_HEADER) or uuid4().hex
    request.state.trace_id = trace_id

    response: Response = await call_next(request)
    response.headers[settings.TRACE_ID_HEADER] = trace_id
    return response
