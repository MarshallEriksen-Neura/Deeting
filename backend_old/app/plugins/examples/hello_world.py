from datetime import datetime
from typing import List, Any
from app.plugins.core.interfaces import AgentPlugin, PluginMetadata


class HelloWorldPlugin(AgentPlugin):
    """
    一个简单的示例插件，展示如何通过宿主接口与系统交互。
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="examples.hello_world",
            version="1.0.0",
            description="A sample plugin that provides basic time and echo tools.",
            author="Gemini CLI"
        )

    def on_activate(self) -> None:
        """
        当插件被加载时，宿主会自动调用此方法。
        """
        logger = self.context.get_logger()
        logger.info(f"HelloWorldPlugin activated! Working dir: {self.context.working_directory}")
        
        # 你可以在这里做一些初始化，比如连接特定的第三方 API
        # 或者从数据库加载一些配置
        db = self.context.get_db_session()
        try:
            # 示例：通过 context 获取数据库并打印当前配置 (假设 settings 里有相关项)
            admin_email = self.context.get_config("ADMIN_EMAIL", "not_set")
            logger.info(f"Admin email from config: {admin_email}")
        finally:
            db.close()

    def get_tools(self) -> List[dict]:
        """
        定义这个插件贡献给 Agent 的工具。
        这里采用标准的 JSON Schema 格式。
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

    # --- 工具的实际逻辑 (Handler) ---
    # 在实际 Agent 运行中，宿主会根据 tool name 路由到这里

    def handle_get_current_system_time(self) -> str:
        return datetime.now().isoformat()

    def handle_echo_user_message(self, message: str) -> str:
        return f"Hello! You said: {message}"
