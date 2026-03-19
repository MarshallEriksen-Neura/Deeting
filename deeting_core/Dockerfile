FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/backend/.venv/bin:${PATH}"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY backend/app /app/backend/app
COPY backend/main.py /app/backend/main.py
COPY backend/alembic.ini /app/backend/alembic.ini
COPY backend/migrations /app/backend/migrations
COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/uv.lock /app/backend/uv.lock
COPY deeting_core/docker/backend-entrypoint.sh /app/backend-entrypoint.sh

WORKDIR /app/backend

RUN chmod +x /app/backend-entrypoint.sh \
    && mkdir -p logs security \
    && uv sync --frozen --no-dev --no-install-project

ENTRYPOINT ["/app/backend-entrypoint.sh"]
CMD ["api"]
