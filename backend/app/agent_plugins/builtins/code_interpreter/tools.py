import logging
from typing import Any

from pydantic import BaseModel, Field

from app.core.sandbox.manager import sandbox_manager

logger = logging.getLogger(__name__)


class CodeInterpreterArgs(BaseModel):
    code: str = Field(
        description="The Python code to execute. Can be a single script or REPL-like commands."
    )
    session_id: str | None = Field(
        default=None, description="Optional session ID for state persistence."
    )


async def run_python(ctx: Any, args: CodeInterpreterArgs) -> str:
    """
    Executes Python code in a stateful, isolated sandbox environment.
    Use this tool to perform calculations, data analysis, or file processing.
    Context (variables) is preserved between calls within the same session.
    """
    # Assuming 'ctx' provides access to the session_id
    # If ctx is a dict or object with session info:
    if args.session_id:
        session_id = args.session_id
    elif hasattr(ctx, "session_id"):
        session_id = ctx.session_id
    elif hasattr(ctx, "user_id"):
        session_id = f"user:{ctx.user_id}"
    elif isinstance(ctx, dict) and "session_id" in ctx:
        session_id = ctx["session_id"]
    else:
        session_id = "user:anonymous"
        logger.warning("No session_id found in context, using user:anonymous")

    logger.info(f"Executing code for session {session_id}")

    result = await sandbox_manager.run_code(session_id, args.code)

    # Format the output for the LLM
    output_parts = []

    if "error" in result:
        return f"Execution Error: {result['error']}"

    if result.get("stdout"):
        # Join list of strings
        output_parts.append(f"STDOUT:\n{''.join(result['stdout'])}")

    if result.get("stderr"):
        output_parts.append(f"STDERR:\n{''.join(result['stderr'])}")

    if result.get("result"):
        output_parts.append(f"RESULT:\n{''.join(result['result'])}")

    if not output_parts:
        return "Code executed successfully (no output)."

    return "\n\n".join(output_parts)


# Tool Definition export
TOOLS = {
    "run_python": {
        "impl": run_python,
        "schema": CodeInterpreterArgs,
        "description": "Executes Python code in a stateful sandbox. Persistent variables supported.",
    }
}
