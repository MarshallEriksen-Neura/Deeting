from __future__ import annotations

from app.protocols.canonical import CanonicalResponse


def render_chat_completion_response(response: CanonicalResponse) -> dict:
    return {
        "id": response.raw_response.get("id") if isinstance(response.raw_response, dict) else None,
        "object": "chat.completion",
        "model": response.model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": response.output_text,
                    **(
                        {"reasoning_content": response.reasoning}
                        if response.reasoning
                        else {}
                    ),
                    **(
                        {
                            "tool_calls": [
                                {
                                    "id": tool.id,
                                    "type": tool.type,
                                    "function": {
                                        "name": tool.name,
                                        "arguments": tool.arguments,
                                    },
                                }
                                for tool in response.tool_calls
                            ]
                        }
                        if response.tool_calls
                        else {}
                    ),
                },
                "finish_reason": response.finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": response.usage.input_tokens,
            "completion_tokens": response.usage.output_tokens,
            "total_tokens": response.usage.total_tokens,
        },
    }
