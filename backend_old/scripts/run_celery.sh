#!/usr/bin/env bash

set -euo pipefail

# 切换到 backend 目录（脚本位于 backend/scripts/ 下）
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${BACKEND_DIR}"

CELERY_APP="app.celery_app.celery_app"
LOG_LEVEL="${CELERY_LOG_LEVEL:-info}"

# 队列配置：包含 default 和 agent 专用队列
# agent_crawl: Playwright 爬虫任务 (并发受限于浏览器资源)
# agent_ingest: 文档上传/入库/规则生成任务
QUEUES="${CELERY_QUEUES:-default,agent_crawl,agent_ingest}"

echo "[run_celery] backend dir: ${BACKEND_DIR}"
echo "[run_celery] celery app : ${CELERY_APP}"
echo "[run_celery] log level  : ${LOG_LEVEL}"
echo "[run_celery] queues     : ${QUEUES}"

echo "[run_celery] 启动 Celery worker ..."
celery -A "${CELERY_APP}" worker -l "${LOG_LEVEL}" -Q "${QUEUES}" &
WORKER_PID=$!

echo "[run_celery] 启动 Celery beat ..."
celery -A "${CELERY_APP}" beat -l "${LOG_LEVEL}" &
BEAT_PID=$!

cleanup() {
  echo "[run_celery] 收到退出信号，停止 Celery 进程 ..."
  kill "${WORKER_PID}" "${BEAT_PID}" 2>/dev/null || true
  wait "${WORKER_PID}" "${BEAT_PID}" 2>/dev/null || true
}

trap cleanup INT TERM

wait "${WORKER_PID}" "${BEAT_PID}"

