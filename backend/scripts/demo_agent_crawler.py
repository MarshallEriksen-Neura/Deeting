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

async def tool_web_search(query: str):
    """真实调用 Tavily 搜索"""
    print(f"\n🔍 [工具调用] 正在搜索: {query}...")
    if not TAVILY_KEY:
        return "Error: TAVILY_API_KEY not set"
    
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": TAVILY_KEY,
                    "query": query,
                    "search_depth": "basic",
                    "max_results": 5
                },
                timeout=15.0
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            print(f"✅ 找到 {len(results)} 条搜索结果。")
            return json.dumps(results)
        except Exception as e:
            return f"Error: Search failed - {str(e)}"

async def tool_scout_inspect(url: str):
    """真实调用 Scout 爬虫服务"""
    print(f"\n🕷️ [工具调用] 正在派遣 Scout 侦察: {url}...")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                SCOUT_URL,
                json={"url": url, "js_mode": True},
                timeout=60.0
            )
            if resp.status_code != 200:
                return f"Error: Scout returned {resp.status_code} - {resp.text}"
            
            data = resp.json()
            if data.get("status") == "failed":
                return f"Error: Scout failed - {data.get('error')}"
            
            markdown = data.get("markdown", "")
            summary = f"Title: {data.get('metadata', {}).get('title')}\nContent Preview: {markdown[:1000]}..."
            print(f"✅ Scout 成功抓取到内容 (长度: {len(markdown)} 字符)。")
            return summary
        except Exception as e:
            return f"Error: Scout connection failed - {str(e)}"

# 工具定义
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网获取最新信息、官方文档或特定主题的链接。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "crawl_website",
            "description": "深入爬取一个特定的 URL 获取其 Markdown 格式的完整内容。请在 web_search 确定 URL 后使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要爬取的完整 URL"}
                },
                "required": ["url"]
            }
        }
    }
]

async def run_agent_simulation():
    if not LLM_BASE_URL or not API_KEY:
        print("❌ 错误: 请在 .env 中设置 TEST_LLM_BASE_URL 和 TEST_API_KEY")
        return

    # 标准化 Endpoint
    endpoint = LLM_BASE_URL.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint += '/chat/completions'

    print(f"⚙️  配置: BaseURL={endpoint}, Model={MODEL}")

    messages = [
        {"role": "system", "content": "你是一个智能研究员。你需要先搜索找到目标的官方文档，然后使用爬虫工具抓取其内容。"},
        {"role": "user", "content": "请帮我找到 Firecrawl 的官方文档，并告诉我它的核心功能是什么。"}
    ]

    print(f"👤 用户: {messages[-1]['content']}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        for turn in range(5):
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

                # 处理工具调用
                for tc in message["tool_calls"]:
                    name = tc["function"]["name"]
                    args = json.loads(tc["function"]["arguments"])
                    
                    result = ""
                    if name == "web_search":
                        result = await tool_web_search(args["query"])
                    elif name == "crawl_website":
                        result = await tool_scout_inspect(args["url"])
                    
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": name,
                        "content": result
                    })
            except Exception as e:
                print(f"❌ LLM 请求失败: {e}")
                if hasattr(e, 'response'):
                    print(f"   响应详情: {e.response.text}")
                break

if __name__ == "__main__":
    asyncio.run(run_agent_simulation())
