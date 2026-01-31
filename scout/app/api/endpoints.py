from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, HttpUrl
from typing import Optional, Dict, Any

from app.services.crawler import crawler_service
from app.services.deep_dive import deep_dive_service

router = APIRouter()

class ScoutRequest(BaseModel):
    url: HttpUrl
    js_mode: bool = True
    instruction: str | None = None

class ScoutResponse(BaseModel):
    status: str
    markdown: str | None = None
    metadata: dict | None = None
    error: str | None = None

class DeepDiveRequest(BaseModel):
    url: HttpUrl
    max_depth: int = 2
    max_pages: int = 20

@router.post("/inspect", response_model=ScoutResponse)
async def inspect_target(request: ScoutRequest):
    """
    Dispatch a Scout to inspect a specific URL (Single Page).
    """
    try:
        url_str = str(request.url)
        result = await crawler_service.inspect_url(url_str, request.js_mode)
        
        if result["status"] == "failed":
            return ScoutResponse(status="failed", error=result.get("error"))
            
        return ScoutResponse(
            status="success",
            markdown=result.get("markdown"),
            metadata={
                "media_count": len(result.get("media", [])),
                "link_count": len(result.get("links", {}).get("internal", []))
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/deep-dive")
async def start_deep_dive(request: DeepDiveRequest):
    """
    Start a recursive deep dive task.
    WARNING: This is a synchronous call that may timeout if max_pages is large.
    For production, this should be async with a callback or polling.
    For the MVP, we assume the caller sets a long timeout (e.g. 5 minutes).
    """
    try:
        result = await deep_dive_service.dive(str(request.url), request.max_depth, request.max_pages)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
