#!/bin/bash
# 验证组件目录结构是否正确创建

set -e

COMPONENTS_DIR="components"
ERRORS=0

echo "🔍 验证组件目录结构..."
echo ""

# 定义需要检查的目录
REQUIRED_DIRS=(
  # Chat 目录
  "chat/core"
  "chat/header"
  "chat/messages"
  "chat/input"
  "chat/sidebar"
  "chat/console"
  "chat/controller"
  "chat/routing"
  "chat/visuals"
  
  # Image 目录
  "image/dashboard"
  "image/history"
  "image/canvas"
  
  # Common 目录
  "common/skeletons"
  "common/voice"
  "common/hud"
  "common/workspace"
  "common/agent-selection"
)

# 检查每个目录是否存在
for dir in "${REQUIRED_DIRS[@]}"; do
  FULL_PATH="$COMPONENTS_DIR/$dir"
  if [ -d "$FULL_PATH" ]; then
    echo "✅ $dir"
  else
    echo "❌ $dir - 目录不存在"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""

# 检查保留的文件
REQUIRED_FILES=(
  "chat/code-block.tsx"
  "chat/markdown-viewer.tsx"
)

echo "🔍 验证保留文件..."
echo ""

for file in "${REQUIRED_FILES[@]}"; do
  FULL_PATH="$COMPONENTS_DIR/$file"
  if [ -f "$FULL_PATH" ]; then
    echo "✅ $file"
  else
    echo "❌ $file - 文件不存在"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""

# 输出结果
if [ $ERRORS -eq 0 ]; then
  echo "✨ 所有目录和文件验证通过！"
  exit 0
else
  echo "⚠️  发现 $ERRORS 个问题"
  exit 1
fi
