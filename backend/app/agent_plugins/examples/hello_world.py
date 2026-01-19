from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.utils.time_utils import Datetime


class HelloWorldPlugin(AgentPlugin):
    """
    A simple example plugin demonstrating host interaction.
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="examples.hello_world",
            version="1.0.0",
            description="A sample plugin that provides basic time and echo tools.",
            author="Gemini CLI"
        )

    async def on_activate(self) -> None:
        """
        Called when the plugin is activated.
        """
        logger = self.context.get_logger()
        logger.info(f"HelloWorldPlugin activated! Working dir: {self.context.working_directory}")

        # Async DB access
        db = self.context.get_db_session()
        try:
            # We don't have a real query here, but this demonstrates getting the session
            admin_email = self.context.get_config("ADMIN_EMAIL", "not_set")
            logger.info(f"Admin email from config: {admin_email}")
        finally:
            await db.close()

    def get_tools(self) -> list[dict]:
        """
        Define tools provided by this plugin.
        """
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_current_system_time",
                    "description": "Get the current time from the server.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "echo_user_message",
                    "description": "Echo back whatever the user said, prefixed with a greeting.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "message": {
                                "type": "string",
                                "description": "The message to echo"
                            }
                        },
                        "required": ["message"]
                    }
                }
            }
        ]

    # --- Tool Handlers ---

    async def handle_get_current_system_time(self) -> str:
        return Datetime.now().isoformat()

    async def handle_echo_user_message(self, message: str) -> str:
        return f"Hello! You said: {message}"
