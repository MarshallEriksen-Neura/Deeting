#!/bin/bash

# 前端代码质量检查脚本
# 用于检查客户端组件使用、文件大小、命名规范等

set -e

echo "🔍 开始前端代码质量检查..."
echo ""

# 切换到 frontend 目录
cd "$(dirname "$0")/.."

# 1. 运行 ESLint 检查
echo "📋 运行 ESLint 检查..."
bun run lint || {
  echo "❌ ESLint 检查失败"
  exit 1
}
echo "✅ ESLint 检查通过"
echo ""

# 2. 运行 TypeScript 类型检查
echo "📋 运行 TypeScript 类型检查..."
npx tsc --noEmit || {
  echo "❌ TypeScript 类型检查失败"
  exit 1
}
echo "✅ TypeScript 类型检查通过"
echo ""

# 3. 检查 page.tsx 文件中的 "use client"
echo "📋 检查 page.tsx 文件中的客户端组件声明..."
PAGE_FILES_WITH_USE_CLIENT=$(find app -name "page.tsx" -type f -exec grep -l '"use client"\|'\''use client'\''' {} \; 2>/dev/null || true)

if [ -n "$PAGE_FILES_WITH_USE_CLIENT" ]; then
  echo "⚠️  警告：以下 page.tsx 文件包含 'use client' 声明："
  echo "$PAGE_FILES_WITH_USE_CLIENT"
  echo ""
  echo "建议：运行 'bun run analyze:server-components' 生成详细分析报告"
else
  echo "✅ 所有 page.tsx 文件都是服务端组件"
fi
echo ""

# 4. 检查大型组件文件（超过 200 行）
echo "📋 检查大型组件文件（超过 200 行）..."
LARGE_FILES=$(find app components -name "*.tsx" -o -name "*.ts" | while read file; do
  # 排除测试文件和类型定义文件
  if [[ ! "$file" =~ \.test\. ]] && [[ ! "$file" =~ \.d\.ts$ ]]; then
    # 计算非空行和非注释行
    LINES=$(grep -v '^\s*$' "$file" | grep -v '^\s*//' | grep -v '^\s*/\*' | wc -l)
    if [ "$LINES" -gt 200 ]; then
      echo "$file: $LINES 行"
    fi
  fi
done)

if [ -n "$LARGE_FILES" ]; then
  echo "⚠️  警告：以下组件文件超过 200 行："
  echo "$LARGE_FILES"
  echo ""
  echo "建议：考虑拆分为更小的子组件"
else
  echo "✅ 所有组件文件大小合理"
fi
echo ""

# 5. 检查文件命名规范
echo "📋 检查文件命名规范（kebab-case）..."
INVALID_NAMES=$(find app components -name "*.tsx" -o -name "*.ts" | while read file; do
  basename=$(basename "$file")
  # 排除特殊文件
  if [[ ! "$basename" =~ ^(page|layout|loading|error|not-found|global-error|route|middleware|instrumentation)\. ]] && \
     [[ ! "$basename" =~ \.test\. ]] && \
     [[ ! "$basename" =~ \.d\.ts$ ]]; then
    # 检查是否符合 kebab-case
    name_without_ext="${basename%.*}"
    if [[ ! "$name_without_ext" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]]; then
      echo "$file"
    fi
  fi
done)

if [ -n "$INVALID_NAMES" ]; then
  echo "⚠️  警告：以下文件不符合 kebab-case 命名规范："
  echo "$INVALID_NAMES"
  echo ""
  echo "建议：使用 kebab-case 命名法（如 user-profile-card.tsx）"
else
  echo "✅ 所有文件命名符合规范"
fi
echo ""

echo "✨ 代码质量检查完成！"
