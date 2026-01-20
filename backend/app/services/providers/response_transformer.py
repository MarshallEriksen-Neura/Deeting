import json
import logging
from typing import Any, Dict, List, Union

from jinja2 import Environment, BaseLoader, select_autoescape, Undefined

logger = logging.getLogger(__name__)

# Silent Undefined (同 RequestRenderer，防止崩塌)
class SilentUndefined(Undefined):
    def _fail_with_undefined_error(self, *args, **kwargs):
        return None
    def __getattr__(self, name):
        return SilentUndefined()
    def __str__(self):
        return ""

jinja_env = Environment(
    loader=BaseLoader(),
    autoescape=select_autoescape(),
    undefined=SilentUndefined,
    trim_blocks=True,
    lstrip_blocks=True
)

class ResponseTransformer:
    """
    负责将上游厂商的异构响应转换为内部统一格式。
    重点处理：Chat Content, Tool Calls, Usage。
    """

    def transform(
        self,
        item_config: Any, # provider_model config
        raw_response: Dict[str, Any],
        status_code: int = 200
    ) -> Dict[str, Any]:
        """
        入口：将原始响应转为标准字典 (模拟 OpenAI ChatCompletionResponse 结构)
        """
        engine = item_config.template_engine or "simple_replace"
        transform_rule = item_config.response_transform or {}

        try:
            # 1. 错误处理 (如果 Upstream 返回非 200，可能需要特殊提取 Error Message)
            if status_code >= 400:
                # 以后可以扩展 Error Transform
                return raw_response

            # 2. 调度引擎
            if engine == "jinja2":
                return self._transform_jinja2(transform_rule, raw_response)
            
            elif engine == "openai_compat":
                # 直接透传，假设已经是标准格式
                return raw_response
            
            elif engine == "anthropic_messages":
                # Claude 原生格式 -> OpenAI 格式
                return self._adapt_anthropic(raw_response)
            
            elif engine == "google_gemini":
                # Gemini 原生格式 -> OpenAI 格式
                return self._adapt_gemini(raw_response)

            # 默认透传
            return raw_response

        except Exception as e:
            logger.error(f"Response transform failed: engine={engine} error={e}")
            # 失败时返回原始数据，让上层决定如何处理
            return raw_response

    def _transform_jinja2(self, template: Dict | str, context: Dict) -> Dict:
        """
        使用 Jinja2 提取字段。
        context 就是 raw_response。
        """
        if not template:
            return context

        def recursive_render(obj):
            if isinstance(obj, str):
                if "{{" in obj:
                    return jinja_env.from_string(obj).render(**context)
                return obj
            elif isinstance(obj, dict):
                return {k: recursive_render(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [recursive_render(elem) for elem in obj]
            return obj

        rendered = recursive_render(template)
        # 如果模板是字符串，尝试解析回 JSON
        if isinstance(rendered, str):
            try:
                return json.loads(rendered)
            except:
                pass
        return rendered

    def _adapt_anthropic(self, raw: Dict) -> Dict:
        """
        Anthropic Messages API Response -> OpenAI ChatCompletionResponse
        """
        # Anthropic: { "content": [ {"type": "text", "text": "..."} ], "usage": ... }
        
        choices = []
        content_str = ""
        tool_calls = []
        
        # 解析 Content Blocks
        for block in raw.get("content", []):
            if block.get("type") == "text":
                content_str += block.get("text", "")
            elif block.get("type") == "tool_use":
                tool_calls.append({
                    "id": block.get("id"),
                    "type": "function",
                    "function": {
                        "name": block.get("name"),
                        "arguments": json.dumps(block.get("input")) # Anthropic returns dict, OpenAI needs string JSON
                    }
                })

        message = {"role": "assistant"}
        if content_str:
            message["content"] = content_str
        if tool_calls:
            message["tool_calls"] = tool_calls
            if not content_str:
                message["content"] = None

        finish_reason = raw.get("stop_reason") or "stop"
        finish_map = {
            "end_turn": "stop",
            "max_tokens": "length",
            "stop_sequence": "stop",
        }
        finish_reason = finish_map.get(finish_reason, finish_reason)

        choices.append({
            "index": 0,
            "message": message,
            "finish_reason": finish_reason,
        })

        return {
            "id": raw.get("id"),
            "object": "chat.completion",
            "choices": choices,
            "usage": {
                "prompt_tokens": raw.get("usage", {}).get("input_tokens", 0),
                "completion_tokens": raw.get("usage", {}).get("output_tokens", 0),
                "total_tokens": (
                    raw.get("usage", {}).get("input_tokens", 0)
                    + raw.get("usage", {}).get("output_tokens", 0)
                ),
            }
        }

    def _adapt_gemini(self, raw: Dict) -> Dict:
        """
        Gemini Response -> OpenAI ChatCompletionResponse
        """
        # Gemini: { "candidates": [ { "content": { "parts": [ { "text": "..." } | { "functionCall": {...}} ] }, "finishReason": "STOP" } ] }
        choices: list[Dict] = []

        candidates = raw.get("candidates") or []
        if candidates:
            cand = candidates[0]
            parts = cand.get("content", {}).get("parts", [])

            text_content = ""
            tool_calls: list[Dict[str, Any]] = []

            for idx, part in enumerate(parts):
                # 文本片段
                if "text" in part:
                    text_content += part.get("text", "")
                    continue

                # 函数调用 (Gemini functionCall)
                func_call = part.get("functionCall") or part.get("function_call")
                if func_call:
                    tool_calls.append(
                        {
                            "id": f"gemini-func-{idx}",
                            "type": "function",
                            "function": {
                                "name": func_call.get("name"),
                                "arguments": json.dumps(func_call.get("args") or {}),
                            },
                        }
                    )

            message: Dict[str, Any] = {"role": "assistant"}
            if text_content:
                message["content"] = text_content
            if tool_calls:
                message["tool_calls"] = tool_calls
                if "content" not in message:
                    message["content"] = None

            finish_reason = (cand.get("finishReason") or "stop").lower()

            choices.append(
                {
                    "index": 0,
                    "message": message,
                    "finish_reason": finish_reason,
                }
            )

        usage_meta = raw.get("usageMetadata", {})
        usage = None
        if usage_meta:
            usage = {
                "prompt_tokens": usage_meta.get("promptTokenCount", 0),
                "completion_tokens": usage_meta.get("candidatesTokenCount", 0),
                "total_tokens": usage_meta.get("totalTokenCount", 0),
            }

        result = {
            "id": raw.get("id") or "gemini-adapt",  # Gemini 不总是返回 id
            "object": "chat.completion",
            "choices": choices,
        }

        if usage is not None:
            result["usage"] = usage

        return result

response_transformer = ResponseTransformer()
