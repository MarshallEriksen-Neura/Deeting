"""
诊断 OpenAI 兼容上游的“思维链字段”是否被网关正确接收/映射。

用途：
1) 直接请求上游 chat/completions，打印原始返回结构；
2) 使用项目内 response_transformer + blocks_transformer 模拟内部映射；
3) 可选：请求内部网关 SSE，观察 status/blocks/final body 三类事件。

默认读取以下已在仓库脚本中使用的环境变量：
- TEST_API_KEY
- TEST_LLM_BASE_URL
- TEST_LLM_MODEL
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from types import SimpleNamespace
from typing import Any

import httpx

# 将 backend 根目录加入路径，便于导入 app.*
BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if BACKEND_ROOT not in sys.path:
    sys.path.append(BACKEND_ROOT)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from app.services.providers.blocks_transformer import (  # noqa: E402
    build_normalized_blocks,
    extract_stream_blocks,
)
from app.services.providers.response_transformer import response_transformer  # noqa: E402


def _load_env() -> None:
    if not load_dotenv:
        return
    env_path = os.path.join(BACKEND_ROOT, ".env")
    if os.path.exists(env_path):
        load_dotenv(env_path)


def _to_pretty_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, default=str)


def _safe_get_message(data: dict[str, Any]) -> dict[str, Any]:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return {}
    first = choices[0]
    if not isinstance(first, dict):
        return {}
    msg = first.get("message")
    return msg if isinstance(msg, dict) else {}


def _normalize_base_url(base_url: str) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized[: -len("/chat/completions")]
    return normalized


def _print_reasoning_probe(title: str, response_json: dict[str, Any]) -> None:
    message = _safe_get_message(response_json)
    print(f"\n=== {title} ===")
    if not message:
        print("未找到 choices[0].message")
        return

    fields = {
        "content": message.get("content"),
        "reasoning_content": message.get("reasoning_content"),
        "reasoning": message.get("reasoning"),
        "thinking": message.get("thinking"),
        "tool_calls": message.get("tool_calls"),
    }
    print(_to_pretty_json(fields))


def _simulate_internal_mapping(raw_response: dict[str, Any], engine: str) -> None:
    item_config = SimpleNamespace(template_engine=engine, response_transform={})
    transformed = response_transformer.transform(
        item_config=item_config,
        raw_response=raw_response,
        status_code=200,
    )
    message = _safe_get_message(transformed)
    reasoning = message.get("reasoning_content")
    content = message.get("content")
    tool_calls = message.get("tool_calls")
    blocks = build_normalized_blocks(
        content=content if isinstance(content, str) else None,
        reasoning=reasoning if isinstance(reasoning, str) else None,
        tool_calls=tool_calls if isinstance(tool_calls, list) else None,
    )

    print("\n=== 内部映射模拟结果 ===")
    print(f"template_engine = {engine}")
    print("transform 后 message 关键字段：")
    print(
        _to_pretty_json(
            {
                "content": content,
                "reasoning_content": reasoning,
                "tool_calls": tool_calls,
            }
        )
    )
    print("build_normalized_blocks 输出：")
    print(_to_pretty_json(blocks))


def _parse_sse_line(line: str) -> dict[str, Any] | None:
    line = line.strip()
    if not line.startswith("data: "):
        return None
    data = line[6:]
    if data == "[DONE]":
        return {"__done__": True}
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        return {"__raw__": data}


def _probe_upstream_non_stream(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    timeout: float,
    temperature: float | None,
    max_tokens: int | None,
    extra_body: dict[str, Any],
    template_engine: str,
) -> None:
    url = f"{_normalize_base_url(base_url)}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    if temperature is not None:
        body["temperature"] = temperature
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    body.update(extra_body)

    print(f"\n>>> 请求上游（非流式）: {url}")
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, headers=headers, json=body)
    print(f"HTTP {resp.status_code}")
    resp.raise_for_status()
    data = resp.json()
    print("\n=== 上游原始 JSON ===")
    print(_to_pretty_json(data))
    _print_reasoning_probe("上游 message 字段探针", data)
    _simulate_internal_mapping(data, template_engine)


def _probe_upstream_stream(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    timeout: float,
    temperature: float | None,
    max_tokens: int | None,
    extra_body: dict[str, Any],
    stream_reasoning_path: str | None,
) -> None:
    url = f"{_normalize_base_url(base_url)}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
    }
    if temperature is not None:
        body["temperature"] = temperature
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    body.update(extra_body)

    stream_transform = {}
    if stream_reasoning_path:
        stream_transform["reasoning_path"] = stream_reasoning_path

    print(f"\n>>> 请求上游（流式）: {url}")
    print(f"stream_transform(reasoning_path) = {stream_transform.get('reasoning_path')}")

    event_count = 0
    thought_count = 0
    text_count = 0
    raw_examples: list[dict[str, Any]] = []

    with httpx.Client(timeout=timeout) as client:
        with client.stream("POST", url, headers=headers, json=body) as resp:
            print(f"HTTP {resp.status_code}")
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                payload = _parse_sse_line(line)
                if payload is None:
                    continue
                if payload.get("__done__"):
                    break
                if "__raw__" in payload:
                    continue
                event_count += 1
                if len(raw_examples) < 5:
                    raw_examples.append(payload)
                blocks = extract_stream_blocks(payload, stream_transform=stream_transform)
                for block in blocks:
                    if block.get("type") == "thought":
                        thought_count += 1
                    elif block.get("type") == "text":
                        text_count += 1

    print("\n=== 流式探针统计 ===")
    print(
        _to_pretty_json(
            {
                "events": event_count,
                "thought_blocks": thought_count,
                "text_blocks": text_count,
                "first_events": raw_examples,
            }
        )
    )


def _probe_gateway_sse(
    *,
    gateway_url: str,
    gateway_token: str,
    model: str,
    prompt: str,
    timeout: float,
    provider_model_id: str | None,
) -> None:
    url = gateway_url.rstrip("/")
    if not url.endswith("/chat/completions"):
        url = f"{url}/api/v1/internal/chat/completions"

    headers = {"Authorization": f"Bearer {gateway_token}", "Content-Type": "application/json"}
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "status_stream": True,
    }
    if provider_model_id:
        body["provider_model_id"] = provider_model_id

    print(f"\n>>> 请求内部网关 SSE: {url}")

    counts = {"status": 0, "blocks": 0, "error": 0, "final_body": 0}
    final_body: dict[str, Any] | None = None

    with httpx.Client(timeout=timeout) as client:
        with client.stream("POST", url, headers=headers, json=body) as resp:
            print(f"HTTP {resp.status_code}")
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                payload = _parse_sse_line(line)
                if payload is None:
                    continue
                if payload.get("__done__"):
                    break
                if "__raw__" in payload:
                    continue
                if not isinstance(payload, dict):
                    continue
                event_type = payload.get("type")
                if event_type in counts:
                    counts[event_type] += 1
                else:
                    # 非 status/blocks/error 的 JSON，按最终 body 统计
                    counts["final_body"] += 1
                    final_body = payload

    print("\n=== 内部网关 SSE 统计 ===")
    print(_to_pretty_json(counts))
    if final_body:
        print("\n=== 内部网关最终 body ===")
        print(_to_pretty_json(final_body))
        _print_reasoning_probe("网关最终 message 字段探针", final_body)


def _load_extra_body(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    if not isinstance(payload, dict):
        raise ValueError("extra-body 文件必须是 JSON object")
    return payload


def main() -> None:
    _load_env()

    parser = argparse.ArgumentParser(description="诊断思维链字段映射")
    parser.add_argument("--base-url", default=os.environ.get("TEST_LLM_BASE_URL", ""))
    parser.add_argument("--api-key", default=os.environ.get("TEST_API_KEY", ""))
    parser.add_argument("--model", default=os.environ.get("TEST_LLM_MODEL", ""))
    parser.add_argument(
        "--prompt",
        default="请先简短回答 1+1，然后给出你的推理步骤。",
    )
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--temperature", type=float, default=None)
    parser.add_argument("--max-tokens", type=int, default=None)
    parser.add_argument(
        "--template-engine",
        default="openai_compat",
        choices=["openai_compat", "simple_replace", "anthropic_messages", "google_gemini", "jinja2"],
    )
    parser.add_argument(
        "--stream",
        action="store_true",
        help="同时探针上游流式事件",
    )
    parser.add_argument(
        "--stream-reasoning-path",
        default=None,
        help="覆盖 extract_stream_blocks 的 reasoning_path（例如 choices.0.delta.reasoning）",
    )
    parser.add_argument(
        "--extra-body",
        default=None,
        help="附加请求体 JSON 文件路径（会 merge 到请求体）",
    )
    parser.add_argument("--gateway-url", default=None, help="可选：内部网关地址")
    parser.add_argument("--gateway-token", default=None, help="可选：内部网关 Bearer Token")
    parser.add_argument("--provider-model-id", default=None, help="可选：内部网关 provider_model_id")

    args = parser.parse_args()

    if not args.base_url or not args.api_key or not args.model:
        print("缺少必要参数：--base-url / --api-key / --model")
        print("可使用环境变量 TEST_LLM_BASE_URL / TEST_API_KEY / TEST_LLM_MODEL")
        sys.exit(2)

    extra_body = _load_extra_body(args.extra_body)

    _probe_upstream_non_stream(
        base_url=args.base_url,
        api_key=args.api_key,
        model=args.model,
        prompt=args.prompt,
        timeout=args.timeout,
        temperature=args.temperature,
        max_tokens=args.max_tokens,
        extra_body=extra_body,
        template_engine=args.template_engine,
    )

    if args.stream:
        _probe_upstream_stream(
            base_url=args.base_url,
            api_key=args.api_key,
            model=args.model,
            prompt=args.prompt,
            timeout=args.timeout,
            temperature=args.temperature,
            max_tokens=args.max_tokens,
            extra_body=extra_body,
            stream_reasoning_path=args.stream_reasoning_path,
        )

    if args.gateway_url and args.gateway_token:
        _probe_gateway_sse(
            gateway_url=args.gateway_url,
            gateway_token=args.gateway_token,
            model=args.model,
            prompt=args.prompt,
            timeout=args.timeout,
            provider_model_id=args.provider_model_id,
        )


if __name__ == "__main__":
    main()

