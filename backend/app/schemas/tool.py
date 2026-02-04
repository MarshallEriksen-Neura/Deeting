from typing import Any

from pydantic import BaseModel, Field


class ToolDefinition(BaseModel):
    """
    Internal standard representation of a Tool (MCP-style).
    """

    name: str
    description: str | None = None
    input_schema: dict[str, Any] = Field(..., description="JSON Schema for arguments")


class ToolCall(BaseModel):
    """
    Internal standard representation of a Tool Call request from LLM.
    """

    id: str
    name: str
    arguments: dict[str, Any]
