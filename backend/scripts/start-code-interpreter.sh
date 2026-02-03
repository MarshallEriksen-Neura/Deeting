#!/bin/bash
# 后台静默启动 code-interpreter 容器

# 先停止并删除已有容器（如果存在）
docker rm -f code-interpreter 2>/dev/null

# 后台启动容器
docker run -d \
  --name code-interpreter \
  --restart unless-stopped \
  -e PYTHON_VERSION=3.11 \
  -e JAVA_VERSION=17 \
  -e NODE_VERSION=20 \
  -e GO_VERSION=1.24 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/code-interpreter:latest

# 检查启动状态
if [ $? -eq 0 ]; then
    echo "✅ Code Interpreter 容器已启动"
    echo "容器 ID: $(docker ps -q -f name=code-interpreter)"
    echo "查看日志: docker logs -f code-interpreter"
    echo "停止容器: docker stop code-interpreter"
    echo "重启容器: docker restart code-interpreter"
else
    echo "❌ 启动失败"
    exit 1
fi
