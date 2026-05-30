#!/usr/bin/env python3
"""
世界模型框架历史表现分析工具

使用方法:
    python analyze_world_model.py [数据库路径]
    python analyze_world_model.py --help

示例:
    python analyze_world_model.py ~/.deeting/mcp.db
    python analyze_world_model.py --export-json report.json
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


class WorldModelAnalyzer:
    """世界模型框架性能分析器"""

    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"数据库文件不存在: {db_path}")
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.conn.close()

    def execute_query(self, query: str) -> List[Dict[str, Any]]:
        """执行SQL查询并返回结果"""
        cursor = self.conn.cursor()
        cursor.execute(query)
        return [dict(row) for row in cursor.fetchall()]

    def get_overall_stats(self) -> Dict[str, Any]:
        """获取总体统计信息"""
        query = """
        SELECT
            COUNT(*) AS total_signals,
            COUNT(DISTINCT fingerprint_key) AS unique_tasks,
            COUNT(DISTINCT session_id) AS total_sessions,
            COUNT(DISTINCT trace_id) AS total_traces,
            MIN(datetime(created_at_unix_ms/1000, 'unixepoch')) AS earliest_record,
            MAX(datetime(created_at_unix_ms/1000, 'unixepoch')) AS latest_record
        FROM evolution_signals
        """
        result = self.execute_query(query)
        return result[0] if result else {}

    def get_classification_stats(self) -> List[Dict[str, Any]]:
        """获取分类统计"""
        query = """
        SELECT
            classification,
            COUNT(*) AS count,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM evolution_signals), 2) AS percentage,
            ROUND(AVG(confidence), 3) AS avg_confidence,
            COUNT(DISTINCT fingerprint_key) AS unique_tasks
        FROM evolution_signals
        GROUP BY classification
        ORDER BY count DESC
        """
        return self.execute_query(query)

    def get_source_stats(self) -> List[Dict[str, Any]]:
        """获取来源统计"""
        query = """
        SELECT
            source,
            COUNT(*) AS count,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM evolution_signals), 2) AS percentage,
            COUNT(DISTINCT fingerprint_key) AS unique_tasks
        FROM evolution_signals
        GROUP BY source
        ORDER BY count DESC
        """
        return self.execute_query(query)

    def get_status_stats(self) -> List[Dict[str, Any]]:
        """获取状态统计"""
        query = """
        SELECT
            status,
            COUNT(*) AS count,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM evolution_signals), 2) AS percentage
        FROM evolution_signals
        GROUP BY status
        ORDER BY
            CASE status
                WHEN 'observed' THEN 1
                WHEN 'classified' THEN 2
                WHEN 'correlated' THEN 3
                WHEN 'applied' THEN 4
                WHEN 'ignored' THEN 5
                ELSE 6
            END
        """
        return self.execute_query(query)

    def get_success_rate(self) -> Dict[str, Any]:
        """获取成功率分析"""
        query = """
        SELECT
            SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
            SUM(CASE WHEN classification = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
            SUM(CASE WHEN classification = 'corrected' THEN 1 ELSE 0 END) AS corrected_count,
            SUM(CASE WHEN classification = 'neutral' THEN 1 ELSE 0 END) AS neutral_count,
            ROUND(
                SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) * 100.0 /
                NULLIF(SUM(CASE WHEN classification IN ('accepted', 'rejected') THEN 1 ELSE 0 END), 0),
                2
            ) AS success_rate
        FROM evolution_signals
        """
        result = self.execute_query(query)
        return result[0] if result else {}

    def get_time_trend(self, days: int = 30) -> List[Dict[str, Any]]:
        """获取时间趋势"""
        query = f"""
        SELECT
            DATE(created_at_unix_ms/1000, 'unixepoch') AS date,
            COUNT(*) AS count,
            COUNT(DISTINCT fingerprint_key) AS unique_tasks,
            SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) AS accepted,
            SUM(CASE WHEN classification = 'rejected' THEN 1 ELSE 0 END) AS rejected
        FROM evolution_signals
        WHERE created_at_unix_ms > 0
        GROUP BY DATE(created_at_unix_ms/1000, 'unixepoch')
        ORDER BY date DESC
        LIMIT {days}
        """
        return self.execute_query(query)

    def get_top_fingerprints(self, limit: int = 10) -> List[Dict[str, Any]]:
        """获取高频任务指纹"""
        query = f"""
        SELECT
            fingerprint_key,
            COUNT(*) AS signal_count,
            SUM(CASE WHEN classification = 'accepted' THEN 1 ELSE 0 END) AS accepted,
            SUM(CASE WHEN classification = 'rejected' THEN 1 ELSE 0 END) AS rejected,
            ROUND(AVG(confidence), 3) AS avg_confidence,
            MIN(datetime(created_at_unix_ms/1000, 'unixepoch')) AS first_seen,
            MAX(datetime(created_at_unix_ms/1000, 'unixepoch')) AS last_seen
        FROM evolution_signals
        WHERE fingerprint_key IS NOT NULL
        GROUP BY fingerprint_key
        ORDER BY signal_count DESC
        LIMIT {limit}
        """
        return self.execute_query(query)

    def get_case_stats(self) -> List[Dict[str, Any]]:
        """获取进化案例统计"""
        query = """
        SELECT
            case_type,
            COUNT(*) AS count,
            COUNT(DISTINCT fingerprint_key) AS unique_tasks,
            ROUND(AVG(confidence), 3) AS avg_confidence,
            MIN(datetime(created_at_unix_ms/1000, 'unixepoch')) AS earliest,
            MAX(datetime(created_at_unix_ms/1000, 'unixepoch')) AS latest
        FROM evolution_cases
        GROUP BY case_type
        ORDER BY count DESC
        """
        return self.execute_query(query)

    def get_confidence_distribution(self) -> List[Dict[str, Any]]:
        """获取置信度分布"""
        query = """
        SELECT
            CASE
                WHEN confidence >= 0.9 THEN '0.9-1.0 (极高)'
                WHEN confidence >= 0.7 THEN '0.7-0.9 (高)'
                WHEN confidence >= 0.5 THEN '0.5-0.7 (中)'
                WHEN confidence >= 0.3 THEN '0.3-0.5 (低)'
                ELSE '0.0-0.3 (极低)'
            END AS confidence_range,
            COUNT(*) AS count,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM evolution_signals), 2) AS percentage
        FROM evolution_signals
        GROUP BY
            CASE
                WHEN confidence >= 0.9 THEN '0.9-1.0 (极高)'
                WHEN confidence >= 0.7 THEN '0.7-0.9 (高)'
                WHEN confidence >= 0.5 THEN '0.5-0.7 (中)'
                WHEN confidence >= 0.3 THEN '0.3-0.5 (低)'
                ELSE '0.0-0.3 (极低)'
            END
        ORDER BY MIN(confidence) DESC
        """
        return self.execute_query(query)

    def generate_report(self) -> Dict[str, Any]:
        """生成完整报告"""
        return {
            "metadata": {
                "database_path": str(self.db_path),
                "analysis_time": datetime.now().isoformat(),
            },
            "overall_stats": self.get_overall_stats(),
            "classification_stats": self.get_classification_stats(),
            "source_stats": self.get_source_stats(),
            "status_stats": self.get_status_stats(),
            "success_rate": self.get_success_rate(),
            "time_trend": self.get_time_trend(),
            "top_fingerprints": self.get_top_fingerprints(),
            "case_stats": self.get_case_stats(),
            "confidence_distribution": self.get_confidence_distribution(),
        }


def print_section(title: str, width: int = 80):
    """打印分节标题"""
    print("\n" + "=" * width)
    print(f" {title}")
    print("=" * width)


def print_table(headers: List[str], rows: List[List[Any]], col_widths: Optional[List[int]] = None):
    """打印表格"""
    if not rows:
        print("  (无数据)")
        return

    if col_widths is None:
        col_widths = [max(len(str(h)), max(len(str(row[i])) for row in rows)) for i, h in enumerate(headers)]

    # 打印表头
    header_line = "  " + " | ".join(str(h).ljust(w) for h, w in zip(headers, col_widths))
    print(header_line)
    print("  " + "-" * (len(header_line) - 2))

    # 打印数据行
    for row in rows:
        print("  " + " | ".join(str(cell).ljust(w) for cell, w in zip(row, col_widths)))


def print_report(report: Dict[str, Any]):
    """打印格式化报告"""
    print_section("世界模型框架历史表现分析报告")

    # 元数据
    metadata = report["metadata"]
    print(f"\n数据库路径: {metadata['database_path']}")
    print(f"分析时间: {metadata['analysis_time']}")

    # 总体统计
    print_section("1. 总体统计")
    stats = report["overall_stats"]
    print(f"  总信号数: {stats.get('total_signals', 0):,}")
    print(f"  唯一任务指纹数: {stats.get('unique_tasks', 0):,}")
    print(f"  涉及会话数: {stats.get('total_sessions', 0):,}")
    print(f"  涉及追踪数: {stats.get('total_traces', 0):,}")
    print(f"  最早记录: {stats.get('earliest_record', 'N/A')}")
    print(f"  最新记录: {stats.get('latest_record', 'N/A')}")

    # 分类统计
    print_section("2. 按分类统计")
    classification_data = report["classification_stats"]
    if classification_data:
        headers = ["分类", "数量", "占比(%)", "平均置信度", "涉及任务数"]
        rows = [
            [
                item["classification"],
                f"{item['count']:,}",
                f"{item['percentage']:.2f}",
                f"{item['avg_confidence']:.3f}",
                f"{item['unique_tasks']:,}",
            ]
            for item in classification_data
        ]
        print_table(headers, rows)

    # 成功率分析
    print_section("3. 成功率分析")
    success = report["success_rate"]
    print(f"  接受数量: {success.get('accepted_count', 0):,}")
    print(f"  拒绝数量: {success.get('rejected_count', 0):,}")
    print(f"  修正数量: {success.get('corrected_count', 0):,}")
    print(f"  中性数量: {success.get('neutral_count', 0):,}")
    success_rate = success.get('success_rate')
    if success_rate is not None:
        print(f"  成功率: {success_rate:.2f}%")
    else:
        print(f"  成功率: N/A (无有效数据)")

    # 来源统计
    print_section("4. 按来源统计")
    source_data = report["source_stats"]
    if source_data:
        headers = ["来源", "数量", "占比(%)", "涉及任务数"]
        rows = [
            [item["source"], f"{item['count']:,}", f"{item['percentage']:.2f}", f"{item['unique_tasks']:,}"]
            for item in source_data
        ]
        print_table(headers, rows)

    # 状态统计
    print_section("5. 按状态统计")
    status_data = report["status_stats"]
    if status_data:
        headers = ["状态", "数量", "占比(%)"]
        rows = [[item["status"], f"{item['count']:,}", f"{item['percentage']:.2f}"] for item in status_data]
        print_table(headers, rows)

    # 高频任务指纹
    print_section("6. 高频任务指纹 (Top 10)")
    fingerprint_data = report["top_fingerprints"]
    if fingerprint_data:
        headers = ["任务指纹", "信号数", "接受", "拒绝", "平均置信度"]
        rows = [
            [
                item["fingerprint_key"][:20] + "..." if len(item["fingerprint_key"]) > 20 else item["fingerprint_key"],
                f"{item['signal_count']:,}",
                f"{item['accepted']:,}",
                f"{item['rejected']:,}",
                f"{item['avg_confidence']:.3f}",
            ]
            for item in fingerprint_data[:10]
        ]
        print_table(headers, rows)

    # 进化案例统计
    print_section("7. 进化案例统计")
    case_data = report["case_stats"]
    if case_data:
        headers = ["案例类型", "数量", "涉及任务数", "平均置信度"]
        rows = [
            [item["case_type"], f"{item['count']:,}", f"{item['unique_tasks']:,}", f"{item['avg_confidence']:.3f}"]
            for item in case_data
        ]
        print_table(headers, rows)
    else:
        print("  (无进化案例数据)")

    # 置信度分布
    print_section("8. 置信度分布")
    confidence_data = report["confidence_distribution"]
    if confidence_data:
        headers = ["置信度区间", "数量", "占比(%)"]
        rows = [[item["confidence_range"], f"{item['count']:,}", f"{item['percentage']:.2f}"] for item in confidence_data]
        print_table(headers, rows)

    # 时间趋势
    print_section("9. 最近30天趋势")
    trend_data = report["time_trend"]
    if trend_data:
        headers = ["日期", "信号数", "任务数", "接受", "拒绝"]
        rows = [
            [item["date"], f"{item['count']:,}", f"{item['unique_tasks']:,}", f"{item['accepted']:,}", f"{item['rejected']:,}"]
            for item in trend_data[:10]  # 只显示最近10天
        ]
        print_table(headers, rows)
        if len(trend_data) > 10:
            print(f"  ... (共 {len(trend_data)} 天数据)")

    print("\n" + "=" * 80)
    print(" 分析完成")
    print("=" * 80 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="世界模型框架历史表现分析工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s ~/.deeting/mcp.db
  %(prog)s --export-json report.json ~/.deeting/mcp.db
        """,
    )
    parser.add_argument("database", nargs="?", help="SQLite数据库文件路径 (默认: ~/.deeting/mcp.db)")
    parser.add_argument("--export-json", metavar="FILE", help="导出JSON格式报告到指定文件")
    parser.add_argument("--export-csv", metavar="DIR", help="导出CSV格式数据到指定目录")

    args = parser.parse_args()

    # 确定数据库路径
    if args.database:
        db_path = args.database
    else:
        db_path = str(Path.home() / ".deeting" / "mcp.db")

    try:
        with WorldModelAnalyzer(db_path) as analyzer:
            report = analyzer.generate_report()

            # 打印报告
            print_report(report)

            # 导出JSON
            if args.export_json:
                with open(args.export_json, "w", encoding="utf-8") as f:
                    json.dump(report, f, ensure_ascii=False, indent=2)
                print(f"✓ JSON报告已导出到: {args.export_json}")

            # 导出CSV
            if args.export_csv:
                csv_dir = Path(args.export_csv)
                csv_dir.mkdir(parents=True, exist_ok=True)

                # 导出各个统计表
                import csv

                for key, data in report.items():
                    if isinstance(data, list) and data:
                        csv_path = csv_dir / f"{key}.csv"
                        with open(csv_path, "w", newline="", encoding="utf-8") as f:
                            writer = csv.DictWriter(f, fieldnames=data[0].keys())
                            writer.writeheader()
                            writer.writerows(data)
                        print(f"✓ CSV已导出: {csv_path}")

    except FileNotFoundError as e:
        print(f"错误: {e}", file=sys.stderr)
        print(f"\n提示: 请确认数据库文件路径是否正确", file=sys.stderr)
        print(f"默认路径: ~/.deeting/mcp.db", file=sys.stderr)
        sys.exit(1)
    except sqlite3.Error as e:
        print(f"数据库错误: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"未预期的错误: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
