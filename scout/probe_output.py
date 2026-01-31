import httpx
import asyncio
import json
import sys

async def probe_scout(url: str):
    scout_api = "http://localhost:8001/v1/scout/inspect"
    
    print(f"🚀 发送探测器至: {url}...")
    
    payload = {
        "url": url,
        "js_mode": True
    }
    
    try:
        async with httpx.AsyncClient() as client:
            # 爬虫可能比较慢，设置长一点的超时
            resp = await client.post(scout_api, json=payload, timeout=60.0)
            
            if resp.status_code != 200:
                print(f"❌ 探测失败 (HTTP {resp.status_code}): {resp.text}")
                return

            data = resp.json()
            
            if data.get("status") == "failed":
                print(f"❌ 爬虫报错: {data.get('error')}")
                return

            print("\n" + "="*50)
            print("✨ 抓取成功！以下是情报摘要：")
            print("="*50)
            
            # 1. 元数据
            print(f"【标题】: {data.get('metadata', {}).get('title', '未知')}")
            print(f"【资源统计】: 图片 x {data.get('metadata', {}).get('media_count', 0)}, "
                  f"内部链接 x {data.get('metadata', {}).get('link_count', 0)}")
            
            # 2. Markdown 内容预览
            markdown = data.get("markdown", "")
            print("\n【Markdown 内容预览 (前 500 字)】:")
            print("-" * 30)
            print(markdown[:500] + "..." if len(markdown) > 500 else markdown)
            print("-" * 30)
            
            # 3. 结构化分析提示
            print("\n💡 AI 建议: 这些数据现在可以被切片并存入 Qdrant 向量库了。")
            
    except Exception as e:
        print(f"❌ 无法连接到 Scout 服务: {e}")
        print("请确保您已在另一个终端运行了: cd scout && python main.py")

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"
    asyncio.run(probe_scout(target))
