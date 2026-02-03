#!/bin/bash
# 停止 code-interpreter 容器

docker stop code-interpreter 2>/dev/null && echo "✅ 容器已停止" || echo "⚠️ 容器未运行"
docker rm -f code-interpreter 2>/dev/null && echo "✅ 容器已删除" || echo ""
