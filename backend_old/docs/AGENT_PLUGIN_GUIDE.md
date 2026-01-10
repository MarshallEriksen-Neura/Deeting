# Agent 插件系统架构与开发指南

本文档详细说明了 backend 采用的“VS Code 风格”插件架构。该架构旨在解耦 Agent 的**业务逻辑**与**底层能力**，使系统具备高度的可扩展性和可维护性。

## 1. 架构概览 (Architecture Overview)

我们将系统分为三层：

### 1.1 宿主层 (Host / Kernel)
*   **Plugin Manager**: 系统的核心，负责扫描、验证、加载和管理插件的生命周期。
*   **Plugin Context**: 每一个插件运行时都拥有一个独立的上下文（Sandbox）。插件通过 Context 获取数据库连接、日志记录器和配置，严禁插件直接 import 全局变量。

### 1.2 插件层 (Extensions)
*   **Plugins**: 独立的 Python 类，封装了特定的能力（如“爬虫”、“向量库存取”、“数据库操作”）。
*   **Tools**: 插件向系统贡献的“工具”（Function Calling 接口），供 LLM 调用。
*   **Manifest**: 描述插件元数据的规范（名称、版本、依赖）。

### 1.3 业务层 (Agent Workflows)
*   **Agent Tasks**: 具体的业务流程（Celery Tasks）。它们不再硬编码底层逻辑，而是声明“我需要什么工具”，由 Plugin Manager 动态提供。

---

## 2. 核心组件 (Core Components)

所有核心接口定义在 `app/plugins/core/` 目录下。

| 文件 | 说明 |
| :--- | :--- |
| `interfaces.py` | 定义了 `AgentPlugin` 基类和 `PluginContext` 接口。 |
| `context.py` | 实现了宿主注入给插件的具体上下文（包含 DB, Logger, Settings）。 |
| `manager.py` | 负责注册、激活和聚合工具。 |

---

## 3. 插件开发指南 (Developer Guide)

### 3.1 创建新插件

假设我们要开发一个 `WeatherPlugin`。

1.  **新建文件**: 在 `app/plugins/builtins/` 下创建 `weather_plugin.py`。
2.  **继承基类**: 继承 `AgentPlugin`。
3.  **定义元数据**: 实现 `metadata` 属性。
4.  **注册工具**: 实现 `get_tools()` 返回 JSON Schema。
5.  **实现逻辑**: 编写 `handle_{tool_name}` 方法。

#### 代码模板

```python
from typing import List, Dict, Any
from app.plugins.core.interfaces import AgentPlugin, PluginMetadata

class WeatherPlugin(AgentPlugin):
    
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.tools.weather",
            version="1.0.0",
            description="Provides weather information."
        )

    def on_activate(self):
        # 初始化资源（可选）
        self.context.get_logger().info("Weather plugin started!")

    def get_tools(self) -> List[dict]:
        return [{
            "type": "function",
            "function": {
                "name": "get_city_weather",
                "description": "Get current weather for a city.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string"}
                    },
                    "required": ["city"]
                }
            }
        }]

    # 工具 Handler：方法名必须是 handle_{tool_name}
    def handle_get_city_weather(self, city: str) -> str:
        # 使用 self.context 获取配置或日志
        api_key = self.context.get_config("WEATHER_API_KEY")
        logger = self.context.get_logger()
        
        logger.info(f"Fetching weather for {city}...")
        return f"The weather in {city} is Sunny."
```

### 3.2 访问系统资源

*   **数据库**: 使用 `session = self.context.get_db_session()`。务必在使用后关闭 session。
*   **日志**: 使用 `logger = self.context.get_logger()`。
*   **配置**: 使用 `val = self.context.get_config("KEY")`。

---

## 4. Agent 集成指南 (Integration)

在 Celery Task 或 Script 中使用插件系统。

### 4.1 初始化与调用

```python
from app.plugins.core.manager import global_plugin_manager
from app.plugins.builtins.weather_plugin import WeatherPlugin

# 1. 注册插件 (通常在应用启动时做一次)
global_plugin_manager.register_class(WeatherPlugin)

# 2. 激活插件
global_plugin_manager.activate_all()

# 3. 获取给 LLM 的工具列表
tools = global_plugin_manager.get_all_tools()
# tools -> [{"type": "function", "function": {"name": "get_city_weather", ...}}]

# 4. 执行工具调用 (模拟 Router)
def execute_tool(name, args):
    for plugin_name, plugin in global_plugin_manager._plugins.items():
        handler_name = f"handle_{name}"
        if hasattr(plugin, handler_name):
            return getattr(plugin, handler_name)(**args)
    raise ValueError("Tool not found")

# 5. 调用
result = execute_tool("get_city_weather", {"city": "Beijing"})
```

---

## 5. 最佳实践 (Best Practices)

1.  **单一职责**: 一个插件只做一类事（例如：`VectorStorePlugin` 只管向量库，不要管爬虫）。
2.  **无全局状态**: 插件内部不要存储请求级别的状态，状态应由 Context 或 参数传递。
3.  **异常隔离**: 插件内部尽量捕获具体异常，并抛出用户友好的错误信息，不要让宿主崩溃。
4.  **依赖注入**: 永远通过 `self.context` 获取资源，方便未来测试和迁移。

## 6. 现有插件列表

*   **`core.registry.provider`**: 管理 Provider Preset 元数据 (`app/plugins/builtins/provider_registry_plugin.py`)。
*   **`core.vector_store.qdrant`**: Qdrant 知识库入库 (`app/plugins/builtins/qdrant_plugin.py`)。
*   **`examples.hello_world`**: 演示插件 (`app/plugins/examples/hello_world.py`)。

---

## 7. Agent Runtime & Execution Loop (Runtime)

为了将 LLM、Agent 任务和插件连接起来，我们提供了 `PluginAwareTaskRunner` 基类 (`app/workers/plugin_runtime.py`)。它实现了标准的 **ReAct (Reason + Act)** 循环。

### 7.1 工作原理

1.  **加载**: 根据任务声明的 `required_plugins`，自动从 Manager 中提取对应的 Tools。
2.  **交互**: 将 Tools 和 Prompt 发送给 LLM。
3.  **路由**: 捕获 LLM 的 Tool Calls，自动路由到对应插件的 Handler。
4.  **循环**: 将执行结果返回给 LLM，直到任务完成。

### 7.2 实现一个 Agent 任务

你只需要继承 `PluginAwareTaskRunner` 并实现 `execute` 方法：

```python
from app.workers.plugin_runtime import PluginAwareTaskRunner

class MyCustomAgent(PluginAwareTaskRunner):
    def __init__(self, task_id, user_query: str):
        # 1. 声明依赖的插件
        super().__init__(task_id, required_plugins=[
            "core.tools.crawler", 
            "core.vector_store.qdrant"
        ])
        self.user_query = user_query

    async def execute(self):
        # 2. 定义 Prompt
        system_prompt = "你是资料整理助手。请先搜索网页，然后存入知识库。"
        
        # 3. 启动 ReAct 循环
        result = await self.run_agent_loop(
            system_prompt=system_prompt,
            user_input=self.user_query,
            max_turns=5
        )
        
        return result
```

### 7.3 接入真实 LLM

在 `app/workers/plugin_runtime.py` 中，你需要将 `_mock_llm_call` 替换为项目中真实的 LLM 服务调用（如 OpenAI Client 或内部的 `chat_completion` 服务）。
