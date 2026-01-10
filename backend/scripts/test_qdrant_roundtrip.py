"""
End-to-end probe: call embeddings API, write to Qdrant, then search back.

Env defaults (can be overridden by args):
- EMBED_URL / TEST_EMBED_URL / EMBED_API_URL
- EMBED_API_KEY / TEST_EMBED_API_KEY / TEST_API_KEY
- EMBED_MODEL / TEST_EMBED_MODEL (default text-embedding-3-small)
- EMBED_INPUT_TYPE / TEST_EMBED_INPUT_TYPE / INPUT_TYPE (auto uses search_document)
- QDRANT_URL / TEST_QDRANT_URL
- QDRANT_API_KEY / TEST_QDRANT_API_KEY
- QDRANT_COLLECTION (default test_embed)

Usage:
  uv run scripts/test_qdrant_roundtrip.py --text "hello qdrant"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from typing import Any

import asyncio
import httpx
from dotenv import load_dotenv

QDRANT_VECTOR_NAME = "text"

load_dotenv()


def env_first(*names: str, fallback: str | None = None) -> str | None:
    for name in names:
        val = os.getenv(name)
        if val and val.strip():
            return val.strip()
    return fallback


def build_embedding_body(model: str, text: str, input_type: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {"model": model, "input": [text]}
    if input_type:
        body["input_type"] = input_type
    return body


async def fetch_embedding(
    client: httpx.AsyncClient, url: str, api_key: str, model: str, text: str, input_type: str | None, timeout: float
) -> list[float]:
    body = build_embedding_body(model, text, input_type)
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    start = time.perf_counter()
    resp = await client.post(url, headers=headers, json=body, timeout=timeout)
    elapsed = (time.perf_counter() - start) * 1000
    print(f"[embed] status={resp.status_code} latency={elapsed:.1f}ms")
    resp.raise_for_status()
    data = resp.json().get("data") or []
    if not data or "embedding" not in data[0]:
        raise RuntimeError("missing embedding in response")
    return data[0]["embedding"]


async def ensure_collection(client: httpx.AsyncClient, base_url: str, name: str, dim: int, api_key: str | None) -> None:
    headers = {"api-key": api_key} if api_key else {}
    resp = await client.get(f"{base_url}/collections/{name}", headers=headers)
    if resp.status_code == 200:
        return
    if resp.status_code != 404:
        resp.raise_for_status()
    body = {
        "vectors": {QDRANT_VECTOR_NAME: {"size": dim, "distance": "Cosine"}},
        "optimizers_config": {"indexing_threshold": 0},  # force HNSW building immediately to avoid plain mode edge cases
    }
    create = await client.put(f"{base_url}/collections/{name}", headers=headers, json=body)
    create.raise_for_status()
    print(f"[qdrant] created collection {name} dim={dim}")


async def upsert_point(
    client: httpx.AsyncClient, base_url: str, name: str, vector: list[float], payload: dict[str, Any], api_key: str | None
) -> str:
    pid = str(uuid.uuid4())
    headers = {"api-key": api_key} if api_key else {}
    body = {"points": [{"id": pid, "vector": {QDRANT_VECTOR_NAME: vector}, "payload": payload}]}
    resp = await client.put(f"{base_url}/collections/{name}/points", headers=headers, params={"wait": "true"}, json=body)
    resp.raise_for_status()
    return pid


async def search_point(
    client: httpx.AsyncClient, base_url: str, name: str, vector: list[float], api_key: str | None
) -> list[dict[str, Any]]:
    headers = {"api-key": api_key} if api_key else {}
    body = {
        # Named vector form for newer Qdrant (name + vector)
        "vector": {"name": QDRANT_VECTOR_NAME, "vector": vector},
        "limit": 3,
        "with_payload": True,
        "with_vector": False,
    }
    # Allow caller to inject raw params if needed
    if os.getenv("QDRANT_SEARCH_EXACT", "").lower() in {"1", "true", "yes"}:
        body.setdefault("params", {})["exact"] = True
    # Some deployments require specifying the search type (hnsw/plain)
    search_type = os.getenv("QDRANT_SEARCH_TYPE")
    if search_type:
        body.setdefault("params", {})["hnsw_ef"] = int(os.getenv("QDRANT_HNSW_EF", "128"))
        body["search_type"] = search_type

    resp = await client.post(f"{base_url}/collections/{name}/points/search", headers=headers, json=body)
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        print(f"[qdrant] search error body: {resp.text}")
        raise exc
    return resp.json().get("result", [])


async def main_async(args: argparse.Namespace) -> int:
    embed_url = args.url or env_first("TEST_EMBED_URL", "EMBED_API_URL", "TEST_API_URL")
    embed_key = args.api_key or env_first("TEST_EMBED_API_KEY", "EMBED_API_KEY", "TEST_API_KEY")
    model = args.model or env_first("TEST_EMBED_MODEL", "EMBED_MODEL", fallback="text-embedding-3-small")
    input_type = args.input_type or env_first("TEST_EMBED_INPUT_TYPE", "EMBED_INPUT_TYPE", "INPUT_TYPE")
    qdrant_url = args.qdrant_url or env_first("TEST_QDRANT_URL", "QDRANT_URL")
    qdrant_key = args.qdrant_api_key or env_first("TEST_QDRANT_API_KEY", "QDRANT_API_KEY")
    collection = args.collection or os.getenv("QDRANT_COLLECTION") or "test_embed"

    if not embed_url or not embed_key:
        print("missing embedding url/api-key; set TEST_EMBED_URL & TEST_EMBED_API_KEY or pass --url/--api-key")
        return 1
    if not qdrant_url:
        print("missing qdrant url; set TEST_QDRANT_URL or QDRANT_URL or pass --qdrant-url")
        return 1

    # auto input_type for asymmetric models if not provided
    if not input_type:
        lowered = (model or "").lower()
        markers = ["embed-english-v3", "embed-multilingual-v3", "cohere-embed", "nemoretriever", "llama-3.2"]
        if any(m in lowered for m in markers):
            input_type = "search_document"

    async with httpx.AsyncClient() as client:
        vector = await fetch_embedding(client, embed_url, embed_key, model, args.text, input_type, args.timeout)
        print(f"[embed] dim={len(vector)} preview={[round(vector[i],4) for i in range(0, min(4,len(vector)))]}")

        qbase = qdrant_url.rstrip("/")
        await ensure_collection(client, qbase, collection, len(vector), qdrant_key)
        pid = await upsert_point(client, qbase, collection, vector, {"source": "test_qdrant_roundtrip", "text": args.text}, qdrant_key)
        print(f"[qdrant] upserted id={pid}")

        hits = await search_point(client, qbase, collection, vector, qdrant_key)
        if not hits:
            print("[qdrant] no hits")
            return 1
        first = hits[0]
        score = first.get("score")
        hid = first.get("id")
        print(f"[qdrant] top hit id={hid} score={score}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Embedding -> Qdrant roundtrip tester.")
    parser.add_argument("--url", help="Embedding endpoint (env TEST_EMBED_URL/EMBED_API_URL)")
    parser.add_argument("--api-key", help="Embedding API key (env TEST_EMBED_API_KEY/EMBED_API_KEY)")
    parser.add_argument("--model", help="Embedding model name")
    parser.add_argument("--input-type", help="input_type for asymmetric models (e.g. search_document/query)")
    parser.add_argument("--text", required=True, help="Text to embed and store/search")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout seconds")
    parser.add_argument("--qdrant-url", help="Qdrant base URL, e.g. http://localhost:6333")
    parser.add_argument("--qdrant-api-key", help="Qdrant API key if required")
    parser.add_argument("--collection", help="Qdrant collection name (default test_embed)")
    return parser.parse_args()


def main() -> int:
    try:
        return asyncio.run(main_async(parse_args()))
    except KeyboardInterrupt:
        return 1


if __name__ == "__main__":
    sys.exit(main())
