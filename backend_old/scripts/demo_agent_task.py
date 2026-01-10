import sys
import os
import json
import logging

# 将项目根目录加入 path 方便 import
sys.path.append(os.getcwd())

from app.plugins.core.manager import global_plugin_manager
from app.plugins.builtins.provider_registry_plugin import ProviderRegistryPlugin
from app.plugins.examples.hello_world import HelloWorldPlugin

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent_demo")

def run_agent_demo():
    print("\n--- 1. 初始化宿主环境 (Host Initialization) ---")
    
    # 注册我们要用的插件
    global_plugin_manager.register_class(ProviderRegistryPlugin)
    global_plugin_manager.register_class(HelloWorldPlugin)
    
    # 激活插件
    global_plugin_manager.activate_all()
    print("✅ 插件系统已就绪")

    print("\n--- 2. 获取可用工具 (Tool Discovery) ---")
    # Agent 引擎询问：“我现在有什么能力？”
    tools = global_plugin_manager.get_all_tools()
    print(f"Agent 发现了 {len(tools)} 个工具:")
    for t in tools:
        print(f"  - {t['function']['name']}: {t['function']['description']}")

    print("\n--- 3. 模拟 Agent 思考与执行 (Execution Loop) ---")
    
    # 假设这是 LLM 的输入任务
    user_task = "请把 OpenAI 的预设配置更新一下，它现在支持 gpt-4-turbo 了。"
    print(f"🧑‍💻 用户指令: {user_task}")

    # ... (此处省略 LLM 调用，假设 LLM 决定调用 update_provider_capabilities) ...
    print("🤖 LLM 思考: 我需要调用 update_provider_capabilities 工具来更新数据库。")
    
    # LLM 生成的工具调用参数
    tool_call_name = "update_provider_capabilities"
    tool_call_args = {
        "preset_id": "openai",
        "capabilities": {
            "models": ["gpt-4", "gpt-3.5-turbo", "gpt-4-turbo"],
            "features": ["chat", "embedding"]
        }
    }
    
    print(f"📞 Agent 正在调用工具: {tool_call_name}")
    print(f"   参数: {json.dumps(tool_call_args, indent=2)}")

    # --- 关键点：宿主如何路由工具调用 ---
    # 在真实系统中，这里会有一个 Router。简单起见，我们手动查找。
    result = None
    
    # 遍历所有插件找到能处理这个工具的插件
    # (实际 Manager 应该提供一个 dispatch_tool_call 方法，这里为了演示手动写一下逻辑)
    for name, plugin in global_plugin_manager._plugins.items():
        # 简单判定：看插件有没有 handle_{tool_name} 方法
        handler_name = f"handle_{tool_call_name}"
        if hasattr(plugin, handler_name):
            handler = getattr(plugin, handler_name)
            try:
                # 执行工具
                result = handler(**tool_call_args)
                print(f"✅ 工具执行成功! 来自插件: {name}")
            except Exception as e:
                print(f"❌ 工具执行失败: {e}")
            break
    
    print(f"\n📄 执行结果反馈:\n{result}")

    print("\n--- 4. 清理环境 ---")
    global_plugin_manager.deactivate_all()
    print("✅ 系统已关闭")

if __name__ == "__main__":
    run_agent_demo()
