from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class ToolDefinition(BaseModel):
    """
    Internal standard representation of a Tool (MCP-style).
    """
    name: str
    description: str | None = None
    input_schema: Dict[str, Any] = Field(..., description="JSON Schema for arguments")

class ToolCall(BaseModel):
    """
    Internal standard representation of a Tool Call request from LLM.
    """
    id: str
    name: str
    arguments: Dict[str, Any]
