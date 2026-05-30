#!/bin/bash
# 世界模型框架历史表现分析脚本 (sqlite3 CLI 版)
#
# 用法: ./run_world_model_analysis.sh [数据库路径]
# 不传路径时自动探测桌面应用默认库位置。
#
# 注意:
#   - 一律以只读模式连接 (sqlite3 -readonly), 桌面应用运行时安全。
#   - 若未安装 sqlite3 CLI, 请改用 Python 版: python analyze_world_model.py
#   - 查询用到 JSON1 扩展 (json_extract), 现代 sqlite3 默认包含。

set -euo pipefail

# 跨平台探测默认数据库路径
detect_default_db() {
    local app_dir="com.deeting.desktop"
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            echo "${APPDATA:-$HOME/AppData/Roaming}/$app_dir/deeting.db" ;;
        Darwin)
            echo "$HOME/Library/Application Support/$app_dir/deeting.db" ;;
        *)
            echo "$HOME/.local/share/$app_dir/deeting.db" ;;
    esac
}

DB_PATH="${1:-$(detect_default_db)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/query_world_model_performance.sql"

# 检查 sqlite3
if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "错误: 未安装 sqlite3 CLI。" >&2
    echo "请改用 Python 版 (无需额外依赖):" >&2
    echo "  python \"$SCRIPT_DIR/analyze_world_model.py\" \"$DB_PATH\"" >&2
    exit 1
fi

if [ ! -f "$DB_PATH" ]; then
    echo "错误: 数据库文件不存在: $DB_PATH" >&2
    echo "用法: $0 [数据库路径]" >&2
    echo "默认探测路径: $(detect_default_db)" >&2
    exit 1
fi

if [ ! -f "$SQL_FILE" ]; then
    echo "错误: 找不到 SQL 查询文件: $SQL_FILE" >&2
    exit 1
fi

echo "=========================================="
echo "世界模型框架历史表现分析"
echo "=========================================="
echo "数据库: $DB_PATH"
echo "分析时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""

# 只读连接执行查询
sqlite3 -readonly "$DB_PATH" < "$SQL_FILE"

echo ""
echo "=========================================="
echo "分析完成"
echo "=========================================="
