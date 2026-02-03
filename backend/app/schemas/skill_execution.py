from typing import Any

from pydantic import Field

from app.schemas.base import BaseSchema


class SkillExecutionRequest(BaseSchema):
    inputs: dict[str, Any] = Field(default_factory=dict)
    intent: str | None = None
    session_id: str | None = None


class SkillExecutionArtifact(BaseSchema):
    name: str
    type: str
    path: str
    size: int | None = None
    content_base64: str | None = None


class SkillExecutionResult(BaseSchema):
    status: str
    stdout: list[str]
    stderr: list[str]
    exit_code: int
    artifacts: list[SkillExecutionArtifact]
