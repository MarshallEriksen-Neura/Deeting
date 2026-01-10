#!/usr/bin/env python3
"""
Generate a Django-style SECRET_KEY (default length: 50 characters).

Usage:
  python scripts/generate_django_secret_key.py
  python scripts/generate_django_secret_key.py --length 64
"""

from __future__ import annotations

import argparse
import secrets
import sys

DEFAULT_ALLOWED_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*(-_=+)"
DEFAULT_LENGTH = 50


def generate_secret_key(length: int = DEFAULT_LENGTH, allowed_chars: str = DEFAULT_ALLOWED_CHARS) -> str:
    if length <= 0:
        raise ValueError("length must be a positive integer")
    if not allowed_chars:
        raise ValueError("allowed_chars must not be empty")
    return "".join(secrets.choice(allowed_chars) for _ in range(length))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a Django-style SECRET_KEY.")
    parser.add_argument(
        "--length",
        type=int,
        default=DEFAULT_LENGTH,
        help=f"length of the generated key (default: {DEFAULT_LENGTH})",
    )
    args = parser.parse_args(argv)

    try:
        secret_key = generate_secret_key(length=args.length)
    except ValueError as exc:
        parser.error(str(exc))
        return 2

    print(secret_key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
