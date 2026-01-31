import logging
from typing import TYPE_CHECKING, Any

from app.schemas.tool import ToolDefinition
from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)

TOOL_NAME = "consult_expert_network"

JIT_PERSONA_TOOL = ToolDefinition(
    name=TOOL_NAME,
    description="Search expert assistants by intent query and return top candidates.",
    input_schema={
        "type": "object",
        "properties": {
            "intent_query": {
                "type": "string",
                "description": "The intent or task description to search for expert assistants.",
            },
            "k": {
                "type": "integer",
                "description": "Number of candidates to return.",
                "default": 3,
            },
        },
        "required": ["intent_query"],
    },
)


def _tool_name(tool: Any) -> str | None:
    if isinstance(tool, ToolDefinition):
        return tool.name
    if isinstance(tool, dict):
        name = tool.get("name")
        if name:
            return str(name)
        function = tool.get("function") or {}
        func_name = function.get("name")
        if func_name:
            return str(func_name)
    return getattr(tool, "name", None)


@step_registry.register
class JitPersonaToolInjectionStep(BaseStep):
    """
    JIT Persona Tool Injection Step.

    仅当未指定 assistant_id 且会话未锁定 assistant_id 时，才注入 consult_expert_network。
    """

    name = "jit_persona_tool_injection"
    depends_on = ["validation", "mcp_discovery"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        if ctx.is_external:
            return StepResult(status=StepStatus.SUCCESS, message="skip_external")

        request = ctx.get("validation", "request")
        assistant_id = getattr(request, "assistant_id", None)
        session_assistant_id = ctx.get("conversation", "session_assistant_id")
        if not session_assistant_id:
            session_assistant_id = getattr(request, "session_assistant_id", None)

        tools = ctx.get("mcp_discovery", "tools") or []
        if assistant_id or session_assistant_id:
            filtered = [tool for tool in tools if _tool_name(tool) != TOOL_NAME]
            if len(filtered) != len(tools):
                ctx.set("mcp_discovery", "tools", filtered)
            logger.debug("jit_persona_tool_injection skipped due to assistant lock")
            return StepResult(status=StepStatus.SUCCESS, message="assistant_locked")

        if not any(_tool_name(tool) == TOOL_NAME for tool in tools):
            tools.append(JIT_PERSONA_TOOL)
        ctx.set("mcp_discovery", "tools", tools)
        return StepResult(status=StepStatus.SUCCESS, message="tool_injected")
