import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.sandbox.manager import sandbox_manager
from app.deps.auth import get_current_user
from app.models import User

router = APIRouter(tags=["Internal Sandbox"])
logger = logging.getLogger(__name__)


class SandboxRunRequest(BaseModel):
    session_id: str = Field(description="Unique session ID for state persistence")
    code: str = Field(description="Code to execute")
    language: str = Field(default="python", description="Language (python)")


class SandboxRunResponse(BaseModel):
    stdout: list[str] = []
    stderr: list[str] = []
    result: list[str] = []
    exit_code: int = 0
    error: str | None = None


@router.post("/sandbox/run", response_model=SandboxRunResponse)
async def run_sandbox_code(
    request: SandboxRunRequest, user: User = Depends(get_current_user)
):
    """
    Execute code in the backend sandbox environment.
    This endpoint is for internal system use (Business Layer).
    """
    try:
        # We append user_id to session_id to ensure isolation between users
        # even if they use the same session_id string
        # safe_session_id = f"{user.id}:{request.session_id}"
        # Actually, for internal system use, we might want explicit control.
        # Let's trust the internal caller (User) to provide the right ID.

        safe_session_id = f"{user.id}:{request.session_id}"
        result = await sandbox_manager.run_code(
            session_id=safe_session_id, code=request.code, language=request.language
        )

        return SandboxRunResponse(
            stdout=result.get("stdout", []),
            stderr=result.get("stderr", []),
            result=result.get("result", []),
            exit_code=result.get("exit_code", 0),
            error=result.get("error"),
        )
    except Exception as e:
        logger.error("Sandbox execution failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Sandbox execution failed")
