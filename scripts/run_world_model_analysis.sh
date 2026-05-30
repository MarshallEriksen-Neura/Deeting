#!/bin/bash
# 世界模型框架历史表现分析脚本
# 使用方法: ./run_world_model_analysis.sh [数据库路径]

set -e

# 默认数据库路径 (根据实际情况调整)
DEFAULT_DB_PATH="$HOME/.deeting/mcp.db"

# 使用参数指定的数据库路径，或使用默认路径
DB_PATH="${1:-$DEFAULT_DB_PATH}"

# 检查数据库文件是否存在
if [ ! -f "$DB_PATH" ]; then
    echo "错误: 数据库文件不存在: $DB_PATH"
    echo "使用方法: $0 [数据库路径]"
    echo "示例: $0 ~/.deeting/mcp.db"
    exit 1
fi

echo "=========================================="
echo "世界模型框架历史表现分析"
echo "=========================================="
echo "数据库路径: $DB_PATH"
echo "分析时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""

# 执行SQL查询
sqlite3 "$DB_PATH" < "$(dirname "$0")/query_world_model_performance.sql"

echo ""
echo "=========================================="
echo "分析完成"
echo "=========================================="
