import asyncio
import json
import logging
from typing import List, Dict, Any, Optional

from app.agent_plugins.core.manager import PluginManager
from app.agent_plugins.builtins.database.plugin import DatabasePlugin
from app.agent_plugins.builtins.provider_registry.plugin import ProviderRegistryPlugin
from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin
from app.agent_plugins.builtins.scheduler.plugin import TaskSchedulerPlugin
from app.agent_plugins.builtins.planner.plugin import PlannerPlugin
from app.agent_plugins.builtins.vector_store.plugin import VectorStorePlugin # Added VectorStore
from app.schemas.tool import ToolDefinition

logger = logging.getLogger(__name__)

class AgentService:
    """
    Generic Agent Runner.
    Orchestrates interaction between LLM, User, and Plugins (Tools).
    """

    def __init__(self):
        self.plugin_manager = PluginManager()
        
        # 1. Register ALL available capabilities here
        self.plugin_manager.register_class(DatabasePlugin)
        self.plugin_manager.register_class(ProviderRegistryPlugin)
        self.plugin_manager.register_class(CrawlerPlugin)
        self.plugin_manager.register_class(TaskSchedulerPlugin)
        self.plugin_manager.register_class(PlannerPlugin)
        self.plugin_manager.register_class(VectorStorePlugin) # Register Qdrant Capabilities
        
        self.tools: List[ToolDefinition] = []
        self.tool_map: Dict[str, Any] = {}
        self._initialized = False

    async def initialize(self):
        """Lazy initialization of plugins and tools."""
        if self._initialized:
            return

        # Activate plugins
        await self.plugin_manager.activate_all()
        
        # Harvest tools
        raw_tools = self.plugin_manager.get_all_tools()
        
        for tool_def in raw_tools:
            func_def = tool_def["function"]
            t_name = func_def["name"]
            
            self.tools.append(ToolDefinition(
                name=t_name,
                description=func_def["description"],
                input_schema=func_def["parameters"]
            ))
            
            # Dynamic handler binding
            handler = self._find_handler(t_name)
            if handler:
                self.tool_map[t_name] = handler
            else:
                logger.warning(f"Tool '{t_name}' advertised but no handler found.")
                
        self._initialized = True

    def _find_handler(self, tool_name: str):
        method_name = f"handle_{tool_name}" # Convention: handle_tool_name
        
        for plugin in self.plugin_manager.plugins.values():
            # Check for direct method on plugin class first
            if hasattr(plugin, tool_name): 
                return getattr(plugin, tool_name)
            # Check for handle_ prefix convention
            if hasattr(plugin, method_name):
                return getattr(plugin, method_name)
        return None

    async def chat(
        self, 
        user_query: str, 
        system_instruction: str,
        model_hint: str = "gpt-4-turbo", 
        conversation_history: List[Dict] = None
    ) -> str:
        """
        Execute a chat turn with the Agent using a specific Persona (System Instruction).
        """
        from app.services.providers.llm import llm_service

        await self.initialize()

        if conversation_history is None:
            conversation_history = []

        # Use the dynamic system instruction passed by the caller
        messages = [{"role": "system", "content": system_instruction}] 
        messages.extend(conversation_history)
        messages.append({"role": "user", "content": user_query})
        
        # ReAct Loop (Reasoning + Acting)
        for turn in range(10): # Max 10 turns to prevent infinite loops
            try:
                response = await llm_service.chat_completion(
                    messages=messages, 
                    tools=self.tools, 
                    model=model_hint, 
                    temperature=0
                )
            except Exception as e:
                logger.error(f"Agent LLM Error: {e}")
                return f"Agent Error: {str(e)}"

            # Case 1: Final Text Response
            if isinstance(response, str):
                return response

            # Case 2: Tool Calls
            elif isinstance(response, list):
                # Add Assistant's thought/tool_call to history
                messages.append({
                    "role": "assistant", 
                    "content": None,
                    "tool_calls": [
                        {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
                        for tc in response
                    ]
                })

                # Execute Tools
                for tool_call in response:
                    func = self.tool_map.get(tool_call.name)
                    if not func:
                        res_str = f"Error: Tool '{tool_call.name}' implementation not found."
                    else:
                        try:
                            if isinstance(tool_call.arguments, dict):
                                res = await func(**tool_call.arguments)
                            else:
                                res = await func(tool_call.arguments)
                            res_str = json.dumps(res, default=str)
                        except Exception as e:
                            logger.exception(f"Tool Execution Error {tool_call.name}")
                            res_str = f"Error executing {tool_call.name}: {str(e)}"

                    # Add Tool Result to history
                    messages.append({
                        "role": "tool", 
                        "tool_call_id": tool_call.id, 
                        "content": res_str
                    })

        return "Agent stopped after max turns."

# Singleton instance
agent_service = AgentService()
