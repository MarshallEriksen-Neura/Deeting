from typing import Any

from app.agent_plugins.builtins.code_interpreter.tools import run_python, CodeInterpreterArgs
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
        # 1. Priority: Direct argument from LLM
        # 2. Secondary: Plugin Context (ConcretePluginContext)
        # 3. Tertiary: Workflow Context (if passed as __context__)
        
        final_session_id = session_id
        
        if not final_session_id:
            # Check ConcretePluginContext
            if self.context and self.context.session_id:
                final_session_id = self.context.session_id
                
        if not final_session_id:
            # Check WorkflowContext (__context__)
            ctx = kwargs.get("__context__")
            if ctx:
                # WorkflowContext might have session_id or trace_id
                if hasattr(ctx, "session_id"):
                    final_session_id = ctx.session_id
                elif hasattr(ctx, "trace_id"):
                    final_session_id = ctx.trace_id

        return await run_python(
            self.context,
            CodeInterpreterArgs(code=code, session_id=final_session_id),
        )

