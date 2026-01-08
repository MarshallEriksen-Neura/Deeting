"""Simple embedding probe script.

Usage examples:
  python backend/scripts/test_embedding.py \
    --url https://api.openai.com/v1/embeddings \
    --api-key sk-xxx \
    --model text-embedding-3-small \
    --text "Hello world"

  python backend/scripts/test_embedding.py \
    --url http://localhost:8000/v1/embeddings \
    --api-key your-key \
    --model embed-multilingual-v3 \
    --file sample.txt

The script prints HTTP status, latency, vector length and a short preview.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

# Allow reading defaults from .env / environment
load_dotenv()


def load_input(args: argparse.Namespace) -> list[str]:
    if args.text:
        return [args.text]
    if args.file:
        path = Path(args.file)
        if not path.is_file():
            raise FileNotFoundError(path)
        return [path.read_text(encoding="utf-8")]
    # stdin fallback
    data = sys.stdin.read().strip()
    if not data:
        raise ValueError("No input provided. Use --text, --file or pipe content to stdin.")
    return [data]


def build_headers(api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def build_body(model: str, inputs: list[str], input_type: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {"model": model, "input": inputs}
    if input_type:
        body["input_type"] = input_type
    return body


def env_first(*names: str, fallback: str | None = None) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value.strip()
    return fallback


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe an embeddings endpoint (OpenAI-compatible).")
    parser.add_argument(
        "--url",
        default=env_first("TEST_EMBED_URL", "EMBED_API_URL", "TEST_API_URL"),
        help="Embeddings endpoint URL (env: TEST_EMBED_URL / EMBED_API_URL / TEST_API_URL)",
    )
    parser.add_argument(
        "--api-key",
        default=env_first("TEST_EMBED_API_KEY", "EMBED_API_KEY", "TEST_API_KEY"),
        help="API key (env: TEST_EMBED_API_KEY / EMBED_API_KEY / TEST_API_KEY)",
    )
    parser.add_argument(
        "--model",
        default=env_first("TEST_EMBED_MODEL", "EMBED_MODEL", fallback="text-embedding-3-small"),
        help="Model name (env: TEST_EMBED_MODEL / EMBED_MODEL)",
    )
    parser.add_argument("--text", help="Single text input")
    parser.add_argument("--file", help="Read text from file instead of --text")
    parser.add_argument("--input-type", help="Optional input_type field (for asymmetric models)")
    parser.add_argument(
        "--truncate",
        choices=["NONE", "START", "END"],
        default=os.getenv("TEST_EMBED_TRUNCATE"),
        help="Optional truncate strategy (e.g. NONE/START/END).",
    )
    parser.add_argument(
        "--encoding-format",
        choices=["float", "base64"],
        default=os.getenv("TEST_EMBED_ENCODING_FORMAT"),
        help="Optional encoding_format (e.g. float/base64).",
    )
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout seconds")
    args = parser.parse_args()

    if not args.url or not args.api_key:
        print("Error: please provide --url and --api-key, or set TEST_EMBED_URL/TEST_EMBED_API_KEY")
        return 1

    inputs = load_input(args)

    # Heuristic: some models require input_type=search_document (asymmetric embedding)
    default_input_type = env_first(
        "TEST_EMBED_INPUT_TYPE",
        "EMBED_INPUT_TYPE",
        "INPUT_TYPE",
        fallback="search_document",
    )
    needs_input_type_markers = [
        "embed-english-v3",
        "embed-multilingual-v3",
        "cohere-embed",
        "nemoretriever",
        "llama-3.2-nemoretriever",
    ]
    auto_input_type = args.input_type
    if not auto_input_type:
        lowered = (args.model or "").lower()
        if any(marker in lowered for marker in needs_input_type_markers):
            auto_input_type = default_input_type

    body = build_body(args.model, inputs, auto_input_type)
    if args.truncate:
        body["truncate"] = args.truncate
    if args.encoding_format:
        body["encoding_format"] = args.encoding_format
    headers = build_headers(args.api_key)

    start = time.perf_counter()
    try:
        resp = httpx.post(args.url, headers=headers, json=body, timeout=args.timeout)
    except Exception as exc:  # pragma: no cover - CLI convenience
        print(f"Request failed: {exc}")
        return 1
    elapsed = (time.perf_counter() - start) * 1000

    print(f"Status: {resp.status_code} | {elapsed:.1f} ms")
    try:
        payload = resp.json()
    except Exception:
        print("Non-JSON response:")
        print(resp.text)
        return 1 if resp.status_code >= 400 else 0

    if resp.status_code >= 400:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 1

    data = payload.get("data") or []
    if not data:
        print("No data field in response")
        return 1

    vector = data[0].get("embedding") if isinstance(data[0], dict) else None
    if not vector:
        print("No embedding found in response")
        return 1

    preview = ", ".join(f"{v:.4f}" for v in vector[:8])
    print(f"Vector length: {len(vector)}")
    print(f"Preview: [{preview} ...]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
