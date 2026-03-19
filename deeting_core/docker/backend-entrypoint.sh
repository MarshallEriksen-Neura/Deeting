#!/bin/sh
set -eu

ROLE="${1:-api}"

cd /app/backend

wait_for_url() {
  target_url="$1"
  target_name="$2"

  if [ -z "${target_url}" ]; then
    return 0
  fi

  python - "$target_url" "$target_name" <<'PY'
import socket
import sys
import time
from urllib.parse import urlparse

target = sys.argv[1]
label = sys.argv[2]
parsed = urlparse(target)
host = parsed.hostname or "localhost"
port = parsed.port

if port is None:
    if parsed.scheme.startswith("postgres"):
        port = 5432
    elif parsed.scheme.startswith("redis"):
        port = 6379
    else:
        port = 80

for attempt in range(60):
    try:
        with socket.create_connection((host, port), timeout=2):
            print(f"[entrypoint] {label} is reachable at {host}:{port}")
            sys.exit(0)
    except OSError as exc:
        if attempt == 59:
            print(
                f"[entrypoint] timed out waiting for {label} at {host}:{port}: {exc}",
                file=sys.stderr,
            )
            sys.exit(1)
        time.sleep(2)
PY
}

ensure_jwt_keys() {
  python - <<'PY'
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

private_path = Path(os.environ.get("JWT_PRIVATE_KEY_PATH", "security/private.pem"))
public_path = Path(os.environ.get("JWT_PUBLIC_KEY_PATH", "security/public.pem"))

if private_path.exists() and public_path.exists():
    print(f"[entrypoint] JWT key pair already present at {private_path} and {public_path}")
    raise SystemExit(0)

private_path.parent.mkdir(parents=True, exist_ok=True)
public_path.parent.mkdir(parents=True, exist_ok=True)

private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
private_bytes = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)
public_bytes = private_key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
)

private_path.write_bytes(private_bytes)
public_path.write_bytes(public_bytes)

print(f"[entrypoint] generated JWT key pair at {private_path} and {public_path}")
PY
}

if [ "${WAIT_FOR_DEPENDENCIES:-1}" = "1" ]; then
  wait_for_url "${DATABASE_URL:-}" "database"
  wait_for_url "${REDIS_URL:-}" "redis"
fi

ensure_jwt_keys

case "$ROLE" in
  api)
    if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
      echo "[entrypoint] running alembic migrations"
      alembic -c alembic.ini upgrade head
    fi
    exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
    ;;
  worker)
    exec celery -A app.core.celery_app.celery_app worker \
      -Q "${CELERY_QUEUES:-default,internal,billing,external,retry,conversation,image_generation,skill_registry,reasoning,notification,monitor_dlq}" \
      -l "${CELERY_LOG_LEVEL:-info}"
    ;;
  *)
    exec "$@"
    ;;
esac
