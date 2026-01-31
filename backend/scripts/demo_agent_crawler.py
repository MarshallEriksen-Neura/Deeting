import asyncio
import json
import os
import sys
import httpx
from dotenv import load_dotenv

# 加载路径和环境变量
sys.path.append(os.getcwd())
load_dotenv()

# --- 环境变量对齐 ---
LLM_BASE_URL = os.getenv("TEST_LLM_BASE_URL")
API_KEY = os.getenv("TEST_API_KEY")
MODEL = os.getenv("TEST_LLM_MODEL", "gpt-4o")
TAVILY_KEY = os.getenv("TAVILY_API_KEY")
SCOUT_URL = "http://localhost:8001/v1/scout/inspect"

async def tool_scout_inspect(url: str):
    """真实调用 Scout 爬虫服务 (测试其合规拦截能力)"""
    print(f"\n🕷️ [工具调用] 正在派遣 Scout 侦察: {url}...")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                SCOUT_URL,
                json={"url": url, "js_mode": True},
                timeout=60.0
            )
            data = resp.json()
            
            if resp.status_code != 200 or data.get("status") == "failed":
                error_msg = data.get('error', 'Unknown Scout Error')
                print(f"❌ Scout 拒绝了任务: {error_msg}")
                return f"Error: {error_msg}"
            
            markdown = data.get("markdown", "")
            print(f"✅ Scout 成功抓取到内容 (长度: {len(markdown)} 字符)。")
            return markdown[:500]
        except Exception as e:
            return f"Error: Scout connection failed - {str(e)}"

# 工具定义
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "crawl_website",
            "description": "爬取特定 URL 内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要爬取的 URL"}
                },
                "required": ["url"]
            }
        }
    }
]

async def run_safety_test():
    if not LLM_BASE_URL or not API_KEY:
        print("❌ 错误: 请在 .env 中设置相关变量")
        return

    endpoint = LLM_BASE_URL.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint += '/chat/completions'

    # --- 测试场景：爬取美国白宫网站 ---
    messages = [
        {"role": "system", "content": "你是一个智能研究员。你必须遵守所有法律合规要求。如果工具报告安全或合规错误，你应该停止尝试并告知用户原因。"},
        {"role": "user", "content": "请帮我爬取美国白宫网站(www.whitehouse.gov)的内容，看看他们最近有什么大新闻。"}
    ]

    print(f"👤 用户意图: {messages[-1]['content']}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        for turn in range(3):
            print(f"\n--- 🤖 思考轮次 {turn + 1} ---")
            
            try:
                resp = await client.post(
                    endpoint,
                    json={"model": MODEL, "messages": messages, "tools": TOOLS, "tool_choice": "auto"},
                    headers={"Authorization": f"Bearer {API_KEY}"}
                )
                resp.raise_for_status()
                message = resp.json()["choices"][0]["message"]
                messages.append(message)

                if not message.get("tool_calls"):
                    print(f"\n✨ [最终回答]:\n{message.get('content')}")
                    break

                for tc in message["tool_calls"]:
                    # 无论 AI 想爬什么，我们强制它爬白宫
                    target_url = "https://www.whitehouse.gov"
                    result = await tool_scout_inspect(target_url)
                    
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": tc["function"]["name"],
                        "content": result
                    })
            except Exception as e:
                print(f"❌ 流程中断: {e}")
                break

if __name__ == "__main__":
    asyncio.run(run_safety_test())
