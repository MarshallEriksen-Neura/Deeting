"""用户知识库写入/检索链路诊断脚本。

用途：
1) 用与线上相同的 QdrantUserVectorService 写入一条个人知识；
2) 立即执行检索（默认不带 score_threshold）；
3) 直连 Qdrant 按 point id 回读，确认是否真实落库；
4) 输出关键维度（collection/user_id/plugin_id/embedding_model）。

示例：
  cd backend
  .venv/bin/python scripts/verify_user_kb_roundtrip.py \
    --user-id 820ae05c-6900-4b07-b3d1-1f1a0959bbd5 \
    --query knowledge_test_20260212
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

# 兼容从 backend 根目录执行
sys.path.append(os.getcwd())

from app.core.config import settings
from app.qdrant_client import close_qdrant_client_for_current_loop, get_qdrant_client
from app.services.vector.qdrant_user_service import QdrantUserVectorService
from app.storage.qdrant_kb_collections import get_kb_user_collection_name
from app.storage.qdrant_kb_store import scroll_points


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验证用户知识库写入后能否检索")
    parser.add_argument("--user-id", required=True, help="真实用户 UUID")
    parser.add_argument(
        "--plugin-id",
        default="system/vector_store",
        help="写入/检索使用的 plugin_id（默认 system/vector_store）",
    )
    parser.add_argument(
        "--embedding-model",
        default=None,
        help="可选：覆盖 embedding model，默认读取 settings.EMBEDDING_MODEL",
    )
    parser.add_argument(
        "--content",
        default=None,
        help="要写入的文本；不传则自动生成唯一文本",
    )
    parser.add_argument(
        "--query",
        default=None,
        help="检索词；不传则使用 content",
    )
    parser.add_argument("--limit", type=int, default=5, help="检索返回条数")
    parser.add_argument(
        "--wait-ms",
        type=int,
        default=200,
        help="写入后等待毫秒数（默认 200ms）",
    )
    parser.add_argument(
        "--skip-write",
        action="store_true",
        help="仅检索，不新增写入（需搭配 --point-id）",
    )
    parser.add_argument(
        "--point-id",
        default=None,
        help="指定 point id（skip-write 模式必填；非 skip 模式可指定）",
    )
    return parser.parse_args()


def _build_filter(user_id: str, plugin_id: str | None, embedding_model: str | None) -> dict[str, Any]:
    must: list[dict[str, Any]] = [{"key": "user_id", "match": {"value": user_id}}]
    if plugin_id:
        must.append({"key": "plugin_id", "match": {"value": plugin_id}})
    if embedding_model:
        must.append({"key": "embedding_model", "match": {"value": embedding_model}})
    return {"must": must}


async def _read_point_by_id(collection_name: str, point_id: str) -> dict[str, Any] | None:
    client = get_qdrant_client()
    resp = await client.post(
        f"/collections/{collection_name}/points",
        json={"ids": [point_id], "with_payload": True, "with_vector": False},
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    points = resp.json().get("result") or []
    if not points:
        return None
    item = points[0]
    return item if isinstance(item, dict) else None


async def _run() -> int:
    args = _parse_args()

    user_uuid = uuid.UUID(str(args.user_id))
    user_id = str(user_uuid)

    embedding_model = args.embedding_model or str(
        getattr(settings, "EMBEDDING_MODEL", "text-embedding-3-small")
    )
    plugin_id = str(args.plugin_id or "").strip() or None

    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    content = args.content or f"KB_ROUNDTRIP_{now}_{uuid.uuid4().hex[:8]}"
    query = args.query or content
    point_id = args.point_id or str(uuid.uuid4())

    collection_name = get_kb_user_collection_name(user_uuid, embedding_model=embedding_model)
    print("=== VERIFY INPUT ===")
    print(json.dumps(
        {
            "qdrant_url": getattr(settings, "QDRANT_URL", ""),
            "collection": collection_name,
            "user_id": user_id,
            "plugin_id": plugin_id,
            "embedding_model": embedding_model,
            "point_id": point_id,
            "query": query,
            "skip_write": bool(args.skip_write),
        },
        ensure_ascii=False,
        indent=2,
    ))

    vector_service = QdrantUserVectorService(
        client=get_qdrant_client(),
        user_id=user_uuid,
        plugin_id=plugin_id,
        embedding_model=embedding_model,
        fail_open=False,
    )

    if args.skip_write:
        if not args.point_id:
            raise ValueError("--skip-write 模式下必须传 --point-id")
    else:
        inserted_id = await vector_service.upsert(
            content,
            payload={
                "source": "verify_user_kb_roundtrip",
                "created_at": now,
            },
            id=point_id,
        )
        print(f"[write] upsert ok, point_id={inserted_id}")
        if args.wait_ms > 0:
            await asyncio.sleep(args.wait_ms / 1000)

    by_id = await _read_point_by_id(collection_name, point_id)
    print(f"[read_by_id] found={bool(by_id)}")
    if by_id:
        payload = by_id.get("payload") or {}
        print(
            json.dumps(
                {
                    "id": by_id.get("id"),
                    "payload.user_id": payload.get("user_id"),
                    "payload.plugin_id": payload.get("plugin_id"),
                    "payload.embedding_model": payload.get("embedding_model"),
                    "payload.content_preview": str(payload.get("content") or "")[:120],
                },
                ensure_ascii=False,
                indent=2,
            )
        )

    hits_default = await vector_service.search(query=query, limit=args.limit)
    print(f"[search default] hits={len(hits_default)}")

    hits_t0 = await vector_service.search(query=query, limit=args.limit, score_threshold=0.0)
    print(f"[search threshold=0.0] hits={len(hits_t0)}")

    filter_current = _build_filter(user_id, plugin_id, embedding_model)
    current_points, _ = await scroll_points(
        get_qdrant_client(),
        collection_name=collection_name,
        limit=20,
        query_filter=filter_current,
        with_payload=True,
    )
    print(f"[scroll current filter] points={len(current_points)}")

    dotted_points_count: int | None = None
    if plugin_id and "/" in plugin_id:
        dotted_filter = _build_filter(user_id, plugin_id.replace("/", "."), embedding_model)
        dotted_points, _ = await scroll_points(
            get_qdrant_client(),
            collection_name=collection_name,
            limit=20,
            query_filter=dotted_filter,
            with_payload=True,
        )
        dotted_points_count = len(dotted_points)
        print(f"[scroll dotted plugin_id] points={dotted_points_count}")

    print("=== QUICK DIAGNOSIS ===")
    if not by_id:
        print("- 失败：point 按 ID 回读不到，说明写入未落库或写到错误 collection。")
        return 2

    if len(hits_default) == 0 and len(current_points) > 0:
        print("- 异常：数据已在库里，但 search 为空，优先检查 query/filter/embedding 模型是否漂移。")
        if dotted_points_count:
            print("- 发现 dotted plugin_id 有数据，可能存在 plugin_id 命名不一致（/ 与 .）。")
        return 3

    print("- 通过：写入、按 ID 回读、语义检索链路均可用。")
    return 0


def main() -> None:
    code = 1
    try:
        code = asyncio.run(_run())
    finally:
        try:
            asyncio.run(close_qdrant_client_for_current_loop())
        except RuntimeError:
            pass
    raise SystemExit(code)


if __name__ == "__main__":
    main()
