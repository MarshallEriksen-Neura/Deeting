#!/usr/bin/env python
"""
生成 Authorization / X-API-Key 请求头所需的 token。
旧版本需要先 Base64 编码，现在直接使用明文 token。

用法示例：
    uv run scripts/encode_token.py timeline
"""

from __future__ import annotations

import argparse
import sys


def normalize_token(value: str) -> str:
    """Return a trimmed token string."""
    token = value.strip()
    if not token:
        raise ValueError("token 不能为空")
    return token


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="生成 Authorization/X-API-Key 头部内容，直接使用明文 token。",
    )
    parser.add_argument(
        "token",
        nargs="?",
        help="要使用的明文 token，例如 timeline",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    token = args.token or input("请输入要使用的明文 token: ").strip()
    if not token:
        print("token 不能为空", file=sys.stderr)
        sys.exit(1)

    try:
        normalized = normalize_token(token)
    except ValueError as exc:
        print(f"处理失败: {exc}", file=sys.stderr)
        sys.exit(1)

    print("=== 结果 ===")
    print(f"明文: {normalized}")
    print("\n在请求头中使用：")
    print(f"Authorization: Bearer {normalized}")
    print(f"X-API-Key: {normalized}")


if __name__ == "__main__":
    main()
