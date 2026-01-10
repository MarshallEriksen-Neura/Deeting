import json
from types import SimpleNamespace

from app.services.providers.response_transformer import ResponseTransformer


def _config(engine: str = "google_gemini"):
    # Minimal provider_model-like object for transformer
    return SimpleNamespace(template_engine=engine, response_transform={})


def test_gemini_text_response_adapts_to_openai_choice():
    raw = {
        "id": "resp-1",
        "candidates": [
            {
                "content": {"parts": [{"text": "Hello"}, {"text": " world"}]},
                "finishReason": "STOP",
            }
        ],
        "usageMetadata": {"promptTokenCount": 12, "candidatesTokenCount": 8, "totalTokenCount": 20},
    }

    rt = ResponseTransformer()
    adapted = rt.transform(_config(), raw_response=raw, status_code=200)

    assert adapted["id"] == "resp-1"
    choice = adapted["choices"][0]
    assert choice["message"]["content"] == "Hello world"
    assert "tool_calls" not in choice["message"]
    assert choice["finish_reason"] == "stop"
    assert adapted["usage"] == {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20}


def test_gemini_function_call_builds_tool_calls():
    raw = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "functionCall": {
                                "name": "search",
                                "args": {"query": "weather"},
                            }
                        }
                    ]
                },
                "finishReason": "STOP",
            }
        ]
    }

    rt = ResponseTransformer()
    adapted = rt.transform(_config(), raw_response=raw, status_code=200)

    choice = adapted["choices"][0]
    message = choice["message"]
    assert message["content"] is None
    assert message["tool_calls"]
    tc = message["tool_calls"][0]
    assert tc["function"]["name"] == "search"
    assert json.loads(tc["function"]["arguments"]) == {"query": "weather"}
    assert choice["finish_reason"] == "stop"
