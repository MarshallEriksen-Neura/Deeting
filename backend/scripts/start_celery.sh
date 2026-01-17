#!/bin/bash

# Ensure we are in the project root
cd "$(dirname "$0")/.."

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Set PYTHONPATH to include the current directory
export PYTHONPATH=$PYTHONPATH:$(pwd)

echo "Starting Celery Worker and Beat..."

# Define queues based on app/core/celery_app.py
# Queues: default, internal, billing, external, retry
QUEUES="default,internal,billing,external,retry"

# Start Celery Worker
# -A: App instance
# -l: Log level
# -Q: Queues
# --hostname: Unique name for the node
echo "Starting Worker..."
celery -A app.core.celery_app worker -l info -Q $QUEUES --hostname=worker@%h &
WORKER_PID=$!

# Start Celery Beat
# -A: App instance
# -l: Log level
echo "Starting Beat..."
celery -A app.core.celery_app beat -l info &
BEAT_PID=$!

# Self-check registered tasks (set CELERY_SELF_CHECK=0 to skip)
if [ "${CELERY_SELF_CHECK:-1}" != "0" ]; then
    echo "Self-check: registered tasks (filtered)..."
    sleep 3
    celery -A app.core.celery_app inspect registered | grep -E "app\.tasks\.|quota_sync\.|apikey_sync\.|memory\." || true
fi

# Function to handle script termination
cleanup() {
    echo "Stopping Celery processes..."
    # Send SIGTERM to worker and beat
    kill -TERM $WORKER_PID 2>/dev/null
    kill -TERM $BEAT_PID 2>/dev/null
    
    # Wait for them to exit
    wait $WORKER_PID 2>/dev/null
    wait $BEAT_PID 2>/dev/null
    
    echo "Celery processes stopped."
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

echo "Celery Worker (PID: $WORKER_PID) and Beat (PID: $BEAT_PID) are running."
echo "Press Ctrl+C to stop."

# Wait for processes to finish (this keeps the script running)
wait $WORKER_PID $BEAT_PID
