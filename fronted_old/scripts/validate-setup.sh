#!/bin/bash

# 验证代码质量工具配置

set -e

echo "🔍 验证代码质量工具配置..."
echo ""

cd "$(dirname "$0")/.."

# 1. 检查 ESLint 配置文件
echo "📋 检查 ESLint 配置..."
if [ -f "eslint.config.mjs" ]; then
  echo "✅ eslint.config.mjs 存在"
else
  echo "❌ eslint.config.mjs 不存在"
  exit 1
fi

# 2. 检查自定义规则目录
echo "📋 检查自定义 ESLint 规则..."
if [ -d "eslint-rules" ]; then
  echo "✅ eslint-rules 目录存在"
  
  if [ -f "eslint-rules/index.js" ]; then
    echo "✅ eslint-rules/index.js 存在"
  else
    echo "❌ eslint-rules/index.js 不存在"
    exit 1
  fi
  
  if [ -f "eslint-rules/check-client-components.js" ]; then
    echo "✅ check-client-components.js 存在"
  else
    echo "❌ check-client-components.js 不存在"
    exit 1
  fi
  
  if [ -f "eslint-rules/check-file-size.js" ]; then
    echo "✅ check-file-size.js 存在"
  else
    echo "❌ check-file-size.js 不存在"
    exit 1
  fi
  
  if [ -f "eslint-rules/check-naming-convention.js" ]; then
    echo "✅ check-naming-convention.js 存在"
  else
    echo "❌ check-naming-convention.js 不存在"
    exit 1
  fi
else
  echo "❌ eslint-rules 目录不存在"
  exit 1
fi
echo ""

# 3. 检查 TypeScript 配置
echo "📋 检查 TypeScript 配置..."
if [ -f "tsconfig.json" ]; then
  echo "✅ tsconfig.json 存在"
  
  # 检查严格模式配置
  if grep -q '"strict": true' tsconfig.json; then
    echo "✅ 严格模式已启用"
  else
    echo "❌ 严格模式未启用"
    exit 1
  fi
  
  if grep -q '"noImplicitAny": true' tsconfig.json; then
    echo "✅ noImplicitAny 已启用"
  else
    echo "❌ noImplicitAny 未启用"
    exit 1
  fi
  
  if grep -q '"noUnusedLocals": true' tsconfig.json; then
    echo "✅ noUnusedLocals 已启用"
  else
    echo "❌ noUnusedLocals 未启用"
    exit 1
  fi
else
  echo "❌ tsconfig.json 不存在"
  exit 1
fi
echo ""

# 4. 检查 package.json 脚本
echo "📋 检查 package.json 脚本..."
if [ -f "package.json" ]; then
  echo "✅ package.json 存在"
  
  if grep -q '"lint"' package.json; then
    echo "✅ lint 脚本存在"
  else
    echo "❌ lint 脚本不存在"
    exit 1
  fi
  
  if grep -q '"type-check"' package.json; then
    echo "✅ type-check 脚本存在"
  else
    echo "❌ type-check 脚本不存在"
    exit 1
  fi
  
  if grep -q '"quality-check"' package.json; then
    echo "✅ quality-check 脚本存在"
  else
    echo "❌ quality-check 脚本不存在"
    exit 1
  fi
else
  echo "❌ package.json 不存在"
  exit 1
fi
echo ""

# 5. 检查代码质量检查脚本
echo "📋 检查代码质量检查脚本..."
if [ -f "scripts/check-code-quality.sh" ]; then
  echo "✅ check-code-quality.sh 存在"
  
  if [ -x "scripts/check-code-quality.sh" ]; then
    echo "✅ check-code-quality.sh 可执行"
  else
    echo "⚠️  check-code-quality.sh 不可执行，正在添加执行权限..."
    chmod +x scripts/check-code-quality.sh
    echo "✅ 已添加执行权限"
  fi
else
  echo "❌ check-code-quality.sh 不存在"
  exit 1
fi
echo ""

# 6. 检查文档
echo "📋 检查文档..."
if [ -f "docs/code-quality-tools.md" ]; then
  echo "✅ code-quality-tools.md 存在"
else
  echo "❌ code-quality-tools.md 不存在"
  exit 1
fi
echo ""

echo "✨ 所有配置验证通过！"
echo ""
echo "📚 可用的命令："
echo "  bun run lint          - 运行 ESLint 检查"
echo "  bun run lint:fix      - 自动修复 ESLint 问题"
echo "  bun run type-check    - 运行 TypeScript 类型检查"
echo "  bun run quality-check - 运行完整的代码质量检查"
echo ""
echo "📖 查看文档："
echo "  cat docs/code-quality-tools.md"
