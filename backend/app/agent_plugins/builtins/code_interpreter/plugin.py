from typing import Any

from app.agent_plugins.builtins.code_interpreter.tools import run_python
from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata


class CodeInterpreterPlugin(AgentPlugin):
    """
    OpenSandbox Code Interpreter Plugin.
    Provides secure, stateful Python execution for AI agents.
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system.code_interpreter",
            version="1.0.0",
            description="Executes Python code in a stateful sandbox. Use for data analysis, math, and file processing.",
            author="Gemini CLI",
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "run_python",
                    "description": "Executes Python code in a stateful, isolated sandbox environment. Persistent variables are supported between calls in the same session.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "type": "string",
                                "description": "The Python code to execute.",
                            },
                            "session_id": {
                                "type": "string",
                                "description": "Optional session ID for state persistence.",
                            },
                        },
                        "required": ["code"],
                    },
                },
            }
        ]

    async def handle_run_python(
        self, code: str, session_id: str | None = None, **kwargs
    ) -> Any:
        """
        Handler for run_python tool.
        """
        # Construct the args object expected by the implementation
        # We need to construct a context-like object or pass the session_id
        # The base AgentPlugin likely has self.context

        # Checking base class implementation (inferred), self.context usually has user/session info
        # Let's wrap the context to match what tools.run_python expects

        class ContextWrapper:
            def __init__(self, ctx):
                self.session_id = ctx.session_id if ctx else "default-session"

        class ArgsWrapper:
            def __init__(self, c, sid):
                self.code = c
                self.session_id = sid

        return await run_python(
            ContextWrapper(self.context), ArgsWrapper(code, session_id)
        )
