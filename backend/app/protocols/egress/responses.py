from __future__ import annotations

from app.protocols.canonical import CanonicalResponse


def render_responses_api_response(response: CanonicalResponse) -> dict:
    return {
        "object": "response",
        "model": response.model,
        "status": response.finish_reason or "completed",
        "output_text": response.output_text,
        "output": [
            {
                "type": "message",
                "content": [
                    {"type": "output_text", "text": response.output_text or ""}
                ],
            }
        ],
        "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "total_tokens": response.usage.total_tokens,
        },
    }
