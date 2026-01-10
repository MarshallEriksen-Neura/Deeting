import json
import asyncio
from typing import List, Dict, Any, Optional
from uuid import UUID

from app.workers.base import AgentTaskRunner
from app.plugins.core.manager import global_plugin_manager
from app.models.agent_task import AgentTaskStatus
from app.logging_config import logger

# 假设这是你的内部 LLM 调用接口，需要根据实际情况替换
# from app.services.chat.completion import chat_completion

class PluginAwareTaskRunner(AgentTaskRunner):
    """
    支持插件系统的 Agent 运行器。
    它负责：
    1. 准备插件工具。
    2. 维护对话历史 (Memory)。
    3. 执行 ReAct 循环 (LLM -> Tool -> Result -> LLM)。
    """

    def __init__(self, task_id: str | UUID, required_plugins: List[str]):
        super().__init__(task_id)
        self.required_plugins = required_plugins
        self.tools: List[Dict] = []
        self.tool_map: Dict[str, Any] = {}
        self.messages: List[Dict] = []
        
    async def prepare_environment(self):
        """加载插件并提取工具"""
        self.begin_step("init_plugins", "Initializing plugins...")
        
        # 1. 确保插件类已注册 (在 main.py 或 worker 启动时应该已经做过 register_class)
        # 这里为了保险，可以再次检查或动态加载
        global_plugin_manager.activate_all()
        
        # 2. 筛选当前任务需要的工具
        # 如果 required_plugins 为空，可能加载所有，或者只加载指定的
        all_plugins = global_plugin_manager._plugins
        
        for name, plugin in all_plugins.items():
            # 简单的名称匹配逻辑，支持前缀匹配
            if any(name.startswith(req) for req in self.required_plugins):
                plugin_tools = plugin.get_tools()
                self.tools.extend(plugin_tools)
                
                # 构建 Tool 路由表
                for t in plugin_tools:
                    tool_name = t["function"]["name"]
                    # 绑定 handler
                    handler_name = f"handle_{tool_name}"
                    if hasattr(plugin, handler_name):
                        self.tool_map[tool_name] = getattr(plugin, handler_name)
                    else:
                        logger.warning(f"Plugin {name} declares tool {tool_name} but has no handler!")
        
        self.end_step("succeeded", f"Loaded {len(self.tools)} tools from {len(self.required_plugins)} plugins.")

    async def run_agent_loop(self, system_prompt: str, user_input: str, max_turns: int = 10) -> Dict:
        """核心 ReAct 循环"""
        await self.prepare_environment()
        
        self.messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input}
        ]
        
        turn = 0
        while turn < max_turns:
            turn += 1
            self.begin_step(f"turn_{turn}", "Thinking...")
            
            # --- 1. 调用 LLM ---
            # TODO: 替换为实际的项目 LLM 调用代码
            # response = await chat_completion(messages=self.messages, tools=self.tools)
            response = await self._mock_llm_call(self.messages, self.tools) # 模拟调用
            
            message = response["message"]
            self.messages.append(message)
            
            # --- 2. 检查是否有工具调用 ---
            tool_calls = message.get("tool_calls")
            
            if not tool_calls:
                # LLM 认为结束了，返回最终文本
                self.end_step("succeeded", "Thought process completed.")
                return {"output": message["content"], "history": self.messages}
            
            # --- 3. 执行工具 ---
            self.update_step("Executing tools...", tool_call=tool_calls)
            
            for tool_call in tool_calls:
                func_name = tool_call["function"]["name"]
                args_str = tool_call["function"]["arguments"]
                call_id = tool_call["id"]
                
                try:
                    args = json.loads(args_str)
                    
                    if func_name in self.tool_map:
                        handler = self.tool_map[func_name]
                        # 执行插件逻辑
                        # 注意：如果 handler 是同步的，这里直接调用；如果是 async，需要 await
                        # 我们的插件接口目前是同步定义的，但在 Celery worker 里运行没问题
                        if asyncio.iscoroutinefunction(handler):
                            result = await handler(**args)
                        else:
                            result = handler(**args)
                            
                        content = str(result)
                    else:
                        content = f"Error: Tool {func_name} not found."
                        
                except Exception as e:
                    content = f"Error executing {func_name}: {str(e)}"
                    logger.exception(f"Tool execution failed: {e}")

                # --- 4. 将结果喂回给 LLM ---
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": func_name,
                    "content": content
                })
                
            self.end_step("succeeded", "Tool execution finished.")

        return {"error": "Max turns reached", "history": self.messages}

    async def _mock_llm_call(self, messages, tools):
        """
        Mock LLM for demonstration. 
        Remove this in production.
        """
        last_msg = messages[-1]["content"]
        if "OpenAI" in last_msg and "update" in last_msg:
             return {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_123",
                        "type": "function",
                        "function": {
                            "name": "update_provider_capabilities",
                            "arguments": '{"preset_id": "openai", "capabilities": {"test": true}}'
                        }
                    }]
                }
            }
        return {
            "message": {
                "role": "assistant",
                "content": "I have completed the task.",
                "tool_calls": None
            }
        }
