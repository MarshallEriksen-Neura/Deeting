from __future__ import annotations

import os
import sys
from pathlib import Path

from app.core.config import settings

SSRF_KEYS = (
    "OUTBOUND_WHITELIST",
    "ALLOW_CUSTOM_UPSTREAM",
    "ALLOW_INTERNAL_NETWORKS",
    "BLOCKED_SUBNETS",
)
CORE_KEYS = (
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_PRIVATE_KEY_PATH",
    "JWT_PUBLIC_KEY_PATH",
    "SECRET_KEY",
)

CHECK_KEYS = SSRF_KEYS + CORE_KEYS


def _is_production() -> bool:
    env = (settings.ENVIRONMENT or "").lower()
    return env == "production"


def _format_list(items: list[str]) -> str:
    return ", ".join(items) if items else "-"


def _resolve_path(path_value: str) -> Path:
    path = Path(path_value)
    if path.is_absolute():
        return path
    base_dir = Path(__file__).resolve().parents[2]
    return base_dir / path


def main() -> int:
    missing_env = [
        key
        for key in CHECK_KEYS
        if os.environ.get(key) is None or os.environ.get(key) == ""
    ]
    warnings: list[str] = []
    errors: list[str] = []

    if missing_env:
        warnings.append(f"Missing env keys: {_format_list(missing_env)}")

    if _is_production():
        if missing_env:
            errors.append(f"Production requires explicit env keys: {_format_list(missing_env)}")
        if settings.ALLOW_INTERNAL_NETWORKS:
            errors.append("Production should not allow internal networks (ALLOW_INTERNAL_NETWORKS=true)")

    if not settings.OUTBOUND_WHITELIST:
        warnings.append("OUTBOUND_WHITELIST is empty; only custom upstreams may pass if enabled")

    if settings.ALLOW_CUSTOM_UPSTREAM and not settings.ALLOW_INTERNAL_NETWORKS and not settings.BLOCKED_SUBNETS:
        warnings.append("BLOCKED_SUBNETS is empty; SSRF protection is weakened")

    private_key_path = settings.JWT_PRIVATE_KEY_PATH
    public_key_path = settings.JWT_PUBLIC_KEY_PATH
    if private_key_path:
        private_path = _resolve_path(private_key_path)
        if not private_path.exists():
            msg = f"JWT_PRIVATE_KEY_PATH file missing: {private_path}"
            (errors if _is_production() else warnings).append(msg)
    if public_key_path:
        public_path = _resolve_path(public_key_path)
        if not public_path.exists():
            msg = f"JWT_PUBLIC_KEY_PATH file missing: {public_path}"
            (errors if _is_production() else warnings).append(msg)

    if "--strict" in sys.argv and missing_env:
        errors.append(f"Strict mode: missing env keys {_format_list(missing_env)}")

    if warnings:
        for msg in warnings:
            print(f"[env-check][warn] {msg}")

    if errors:
        for msg in errors:
            print(f"[env-check][error] {msg}", file=sys.stderr)
        return 1

    print("[env-check][ok] environment configuration looks good")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
