from fastapi import APIRouter, Response

from app.core.metrics import metrics_content

router = APIRouter(tags=["Metrics"])


@router.get("/metrics")
async def metrics() -> Response:
    return Response(content=metrics_content(), media_type="text/plain; version=0.0.4")
