import asyncio
import os
import sys
import json

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

# 自动从 .env 获取 SCOUT_SERVICE_URL
SCOUT_SERVICE_BASE = os.getenv("SCOUT_SERVICE_URL", "http://localhost:8001")
SCOUT_URL = f"{SCOUT_SERVICE_BASE.rstrip('/')}/v1/scout/inspect"


async def tool_scout_inspect(url: str):
    """真实调用 Scout 爬虫服务 (测试其合规拦截能力)"""
    print(f"\n🕷️ [工具调用] 正在派遣 Scout 侦察: {url}...")
    print(f"📡 使用 Scout API: {SCOUT_URL}")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                SCOUT_URL, json={"url": url, "js_mode": True}, timeout=60.0
            )
            data = resp.json()

            if resp.status_code != 200 or data.get("status") == "failed":
                error_msg = data.get("error", "Unknown Scout Error")
                print(f"❌ Scout 拒绝了任务或失败: {error_msg}")
                return f"Error: {error_msg}"

            markdown = data.get("markdown", "")
            print(f"✅ Scout 成功抓取到内容 (长度: {len(markdown)} 字符)。")
            return markdown[:1000] # 返回更多内容供参考
        except Exception as e:
            return f"Error: Scout connection failed - {e!s}"


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
                "required": ["url"],
            },
        },
    }
]


async def run_safety_test(target_url: str):
    # --- 测试场景：爬取指定的 AI 文档 ---
    messages = [
        {
            "role": "system",
            "content": "你是一个智能研究员。你正在分析 AI 文档。请使用工具爬取内容并总结核心功能。",
        },
        {
            "role": "user",
            "content": f"请帮我分析一下这个 AI 文档的内容: {target_url}",
        },
    ]

    print(f"👤 用户意图: {messages[-1]['content']}")
    
    # 如果没有配置 LLM，则直接调用工具测试
    if not LLM_BASE_URL or not API_KEY:
        print("⚠️ 未配置 LLM，直接执行工具调用测试...")
        await tool_scout_inspect(target_url)
        return

    endpoint = LLM_BASE_URL.rstrip("/")
    if not endpoint.endswith("/chat/completions"):
        endpoint += "/chat/completions"

    async with httpx.AsyncClient(timeout=120.0) as client:
        for turn in range(3):
            print(f"\n--- 🤖 思考轮次 {turn + 1} ---")

            try:
                resp = await client.post(
                    endpoint,
                    json={
                        "model": MODEL,
                        "messages": messages,
                        "tools": TOOLS,
                        "tool_choice": "auto",
                    },
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                resp.raise_for_status()
                message = resp.json()["choices"][0]["message"]
                messages.append(message)

                if not message.get("tool_calls"):
                    print(f"\n✨ [最终回答]:\n{message.get('content')}")
                    break

                for tc in message["tool_calls"]:
                    # 解析 AI 想爬取的 URL，或者使用传入的目标 URL
                    args = json.loads(tc["function"]["arguments"])
                    actual_url = args.get("url", target_url)
                    result = await tool_scout_inspect(actual_url)

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "name": tc["function"]["name"],
                            "content": result,
                        }
                    )
            except Exception as e:
                print(f"❌ 流程中断: {e}")
                break


if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else "https://docs.jina.ai"
    asyncio.run(run_safety_test(target))
