#!/bin/bash

# 国际化检查脚本
# 检查所有组件是否正确使用 useI18n Hook 和是否有硬编码字符串

echo "=========================================="
echo "国际化实现检查报告"
echo "=========================================="
echo ""

# 定义要检查的目录
DIRS=(
  "components/chat"
  "components/image"
  "components/common"
)

# 1. 检查 useI18n Hook 的使用情况
echo "1. useI18n Hook 使用情况"
echo "----------------------------------------"
for dir in "${DIRS[@]}"; do
  echo ""
  echo "检查目录: deeting/$dir"
  
  # 统计总文件数
  total_files=$(find "deeting/$dir" -name "*.tsx" -type f | wc -l)
  echo "  总组件文件数: $total_files"
  
  # 统计使用 useI18n 的文件数
  use_i18n_files=$(grep -r "useI18n" "deeting/$dir" --include="*.tsx" -l | wc -l)
  echo "  使用 useI18n 的文件数: $use_i18n_files"
  
  # 列出使用 useI18n 的文件
  if [ $use_i18n_files -gt 0 ]; then
    echo "  使用 useI18n 的文件:"
    grep -r "useI18n" "deeting/$dir" --include="*.tsx" -l | sed 's/^/    - /'
  fi
  
  # 列出未使用 useI18n 的文件
  echo ""
  echo "  未使用 useI18n 的文件:"
  comm -23 \
    <(find "deeting/$dir" -name "*.tsx" -type f | sort) \
    <(grep -r "useI18n" "deeting/$dir" --include="*.tsx" -l | sort) \
    | sed 's/^/    - /'
done

echo ""
echo ""

# 2. 检查硬编码的中文字符串
echo "2. 硬编码中文字符串检查"
echo "----------------------------------------"
for dir in "${DIRS[@]}"; do
  echo ""
  echo "检查目录: deeting/$dir"
  
  # 查找包含中文字符的文件
  files_with_chinese=$(grep -r "[\u4e00-\u9fa5]" "deeting/$dir" --include="*.tsx" -l 2>/dev/null | wc -l)
  echo "  包含中文字符的文件数: $files_with_chinese"
  
  if [ $files_with_chinese -gt 0 ]; then
    echo "  包含中文字符的文件:"
    grep -r "[\u4e00-\u9fa5]" "deeting/$dir" --include="*.tsx" -l 2>/dev/null | sed 's/^/    - /'
  fi
done

echo ""
echo ""

# 3. 检查硬编码的英文字符串（在 JSX 中）
echo "3. JSX 中可能的硬编码英文字符串检查"
echo "----------------------------------------"
echo "（检查 > 和 < 之间的英文文本，排除常见的技术术语）"
for dir in "${DIRS[@]}"; do
  echo ""
  echo "检查目录: deeting/$dir"
  
  # 这个检查比较复杂，我们只做简单的模式匹配
  # 查找 >text< 模式的英文字符串
  grep -rn ">[A-Z][a-z].*<" "deeting/$dir" --include="*.tsx" 2>/dev/null | \
    grep -v "className" | \
    grep -v "import" | \
    grep -v "export" | \
    head -20 | \
    sed 's/^/  /'
done

echo ""
echo "=========================================="
echo "检查完成"
echo "=========================================="
