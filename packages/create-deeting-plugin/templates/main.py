from typing import Any

async def invoke(tool_name: str, args: dict[str, Any], deeting: Any) -> Any:
    """
    Deeting 插件核心入口。
    
    :param tool_name: llm-tool.yaml 中定义的工具名
    :param args: LLM 传入的参数字典
    :param deeting: Deeting SDK 对象，提供 call_tool, render, log 等能力
    """
    deeting.log(f"Executing tool: {tool_name} with args: {args}")
    
    if tool_name == "hello_deeting":
        name = args.get("name", "Stranger")
        message = f"Hello {name}! This is your custom plugin speaking."
        
        # 渲染 UI Block (可选)
        deeting.render(
            view_type="bento.grid",
            title="Plugin Response",
            payload={
                "items": [
                    {"title": "Status", "value": "Active", "color": "emerald"},
                    {"title": "User", "value": name}
                ]
            }
        )
        
        return {"message": message}
    
    raise ValueError(f"Unknown tool: {tool_name}")
