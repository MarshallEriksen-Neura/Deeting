#!/usr/bin/env python3
"""
世界模型框架历史表现分析工具

数据源 (主库 deeting.db) 真实表:
  - task_learning_runs       每次任务执行的学习记录 (核心)
  - task_policy_priors       学到的策略先验
  - posterior_signal_events  后验信号事件
  - evolution_signals        进化信号 (辅助)

用法:
    python analyze_world_model.py [数据库路径]
    python analyze_world_model.py --export-json report.json
    python analyze_world_model.py --export-csv ./csv_out

不传路径时自动探测桌面应用默认库位置:
    Windows: %APPDATA%\\com.deeting.desktop\\deeting.db
    macOS:   ~/Library/Application Support/com.deeting.desktop/deeting.db
    Linux:   ~/.local/share/com.deeting.desktop/deeting.db

注意: 桌面应用运行时会持有该库 (WAL 模式), 本工具一律以只读模式连接, 不会写入或加锁。
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# 修复 Windows 控制台中文乱码 (GBK -> UTF-8)
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def default_db_path() -> Path:
    """跨平台探测桌面应用默认数据库路径。"""
    app_dir = "com.deeting.desktop"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / app_dir / "deeting.db"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / app_dir / "deeting.db"
    return Path.home() / ".local" / "share" / app_dir / "deeting.db"


class WorldModelAnalyzer:
    """世界模型框架性能分析器 (只读)。"""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"数据库文件不存在: {self.db_path}")
        # 只读 URI 连接, 避免与运行中的桌面应用争锁
        uri = f"file:{self.db_path.as_posix()}?mode=ro"
        self.conn = sqlite3.connect(uri, uri=True)
        self.conn.row_factory = sqlite3.Row

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.conn.close()

    def _rows(self, sql: str) -> list[dict[str, Any]]:
        cur = self.conn.cursor()
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]

    def _one(self, sql: str) -> dict[str, Any]:
        rows = self._rows(sql)
        return rows[0] if rows else {}

    # ---- task_learning_runs ----
    def overall(self) -> dict[str, Any]:
        return self._one(
            """
            SELECT COUNT(*) AS runs,
                   COUNT(DISTINCT fingerprint_key) AS tasks,
                   COUNT(DISTINCT session_id) AS sessions,
                   COUNT(DISTINCT trace_id) AS traces,
                   SUM(learning_eligible) AS eligible,
                   datetime(MIN(created_at_unix_ms)/1000,'unixepoch') AS earliest,
                   datetime(MAX(created_at_unix_ms)/1000,'unixepoch') AS latest
            FROM task_learning_runs
            """
        )

    def _outcome_dist(self, field: str) -> list[dict[str, Any]]:
        return self._rows(
            f"""
            SELECT json_extract(outcome_json,'$.{field}') AS value,
                   COUNT(*) AS count,
                   ROUND(COUNT(*)*100.0/(SELECT COUNT(*) FROM task_learning_runs
                                         WHERE json_valid(outcome_json)),1) AS pct
            FROM task_learning_runs
            WHERE json_valid(outcome_json)
            GROUP BY value ORDER BY count DESC
            """
        )

    def final_status(self):
        return self._outcome_dist("final_status")

    def verification(self):
        return self._outcome_dist("verification_result")

    def cost_class(self):
        return self._outcome_dist("cost_class")

    def judgments(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "route_judgment": self._outcome_dist("route_judgment"),
            "discovery_judgment": self._outcome_dist("discovery_judgment"),
            "execution_judgment": self._outcome_dist("execution_judgment"),
        }

    def routes(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT json_extract(execution_policy_json,'$.route') AS route,
                   json_extract(execution_policy_json,'$.plane') AS plane,
                   COUNT(*) AS count,
                   ROUND(COUNT(*)*100.0/(SELECT COUNT(*) FROM task_learning_runs
                                         WHERE json_valid(execution_policy_json)),1) AS pct
            FROM task_learning_runs
            WHERE json_valid(execution_policy_json)
            GROUP BY route, plane ORDER BY count DESC
            """
        )

    def confidence_bands(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT CASE
                     WHEN json_extract(outcome_json,'$.confidence')>=0.8 THEN '0.8-1.0 (高)'
                     WHEN json_extract(outcome_json,'$.confidence')>=0.6 THEN '0.6-0.8 (中高)'
                     WHEN json_extract(outcome_json,'$.confidence')>=0.4 THEN '0.4-0.6 (中)'
                     ELSE '<0.4 (低)'
                   END AS band,
                   COUNT(*) AS count,
                   ROUND(AVG(json_extract(outcome_json,'$.confidence')),3) AS avg
            FROM task_learning_runs
            WHERE json_valid(outcome_json)
            GROUP BY band ORDER BY band DESC
            """
        )

    def user_signals(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT COALESCE(last_signal,'(null)') AS signal,
                   COUNT(*) AS count,
                   ROUND(COUNT(*)*100.0/(SELECT COUNT(*) FROM task_learning_runs),1) AS pct
            FROM task_learning_runs GROUP BY last_signal ORDER BY count DESC
            """
        )

    def learning_state(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT learning_eligible AS eligible,
                   COALESCE(delta_state,'(null)') AS delta_state,
                   COUNT(*) AS count
            FROM task_learning_runs
            GROUP BY learning_eligible, delta_state ORDER BY count DESC
            """
        )

    def policy_deltas(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT json_extract(policy_delta_json,'$.decision_point') AS decision_point,
                   json_extract(policy_delta_json,'$.action_key') AS action_key,
                   json_extract(policy_delta_json,'$.direction') AS direction,
                   COUNT(*) AS count,
                   ROUND(AVG(json_extract(policy_delta_json,'$.magnitude')),3) AS avg_magnitude
            FROM task_learning_runs
            WHERE json_valid(policy_delta_json)
            GROUP BY decision_point, action_key, direction
            ORDER BY count DESC LIMIT 15
            """
        )

    def weekly_trend(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT strftime('%Y-W%W', datetime(created_at_unix_ms/1000,'unixepoch')) AS week,
                   COUNT(*) AS runs,
                   COUNT(DISTINCT fingerprint_key) AS tasks,
                   SUM(learning_eligible) AS eligible,
                   SUM(CASE WHEN json_extract(outcome_json,'$.final_status')='success' THEN 1 ELSE 0 END) AS success,
                   SUM(CASE WHEN json_extract(outcome_json,'$.final_status')='blocked' THEN 1 ELSE 0 END) AS blocked,
                   ROUND(AVG(json_extract(outcome_json,'$.confidence')),3) AS avg_conf
            FROM task_learning_runs GROUP BY week ORDER BY week
            """
        )

    def top_fingerprints(self, limit: int = 12) -> list[dict[str, Any]]:
        return self._rows(
            f"""
            SELECT substr(fingerprint_key,1,16) AS fingerprint,
                   COUNT(*) AS runs,
                   SUM(learning_eligible) AS eligible,
                   SUM(CASE WHEN json_extract(outcome_json,'$.final_status')='success' THEN 1 ELSE 0 END) AS success,
                   SUM(CASE WHEN json_extract(outcome_json,'$.final_status')='blocked' THEN 1 ELSE 0 END) AS blocked,
                   ROUND(AVG(json_extract(outcome_json,'$.confidence')),3) AS avg_conf
            FROM task_learning_runs GROUP BY fingerprint_key ORDER BY runs DESC LIMIT {limit}
            """
        )

    # ---- task_policy_priors ----
    def prior_maturity(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT maturity, COUNT(*) AS count,
                   ROUND(AVG(weight),3) AS avg_weight,
                   ROUND(AVG(confidence),3) AS avg_confidence,
                   SUM(evidence_count) AS total_evidence
            FROM task_policy_priors GROUP BY maturity ORDER BY count DESC
            """
        )

    def top_priors(self, limit: int = 10) -> list[dict[str, Any]]:
        return self._rows(
            f"""
            SELECT decision_point, substr(action_key,1,20) AS action_key,
                   ROUND(weight,3) AS weight, ROUND(confidence,3) AS confidence,
                   evidence_count, maturity
            FROM task_policy_priors
            ORDER BY evidence_count DESC, confidence DESC LIMIT {limit}
            """
        )

    # ---- posterior_signal_events / evolution_signals ----
    def posterior_signals(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT signal, source, COUNT(*) AS count, ROUND(AVG(confidence),3) AS avg_conf
            FROM posterior_signal_events GROUP BY signal, source ORDER BY count DESC
            """
        )

    def evolution_signals(self) -> list[dict[str, Any]]:
        return self._rows(
            """
            SELECT source, classification, COUNT(*) AS count, ROUND(AVG(confidence),3) AS avg_conf
            FROM evolution_signals GROUP BY source, classification ORDER BY count DESC
            """
        )

    def report(self) -> dict[str, Any]:
        return {
            "metadata": {"database_path": str(self.db_path), "analysis_time": datetime.now().isoformat()},
            "overall": self.overall(),
            "final_status": self.final_status(),
            "verification": self.verification(),
            "cost_class": self.cost_class(),
            "judgments": self.judgments(),
            "routes": self.routes(),
            "confidence_bands": self.confidence_bands(),
            "user_signals": self.user_signals(),
            "learning_state": self.learning_state(),
            "policy_deltas": self.policy_deltas(),
            "weekly_trend": self.weekly_trend(),
            "top_fingerprints": self.top_fingerprints(),
            "prior_maturity": self.prior_maturity(),
            "top_priors": self.top_priors(),
            "posterior_signals": self.posterior_signals(),
            "evolution_signals": self.evolution_signals(),
        }


def _table(rows: list[dict[str, Any]]):
    if not rows:
        print("  (无数据)")
        return
    headers = list(rows[0].keys())
    widths = [max(len(str(h)), max(len(str(r[h])) for r in rows)) for h in headers]
    print("  " + " | ".join(str(h).ljust(w) for h, w in zip(headers, widths)))
    print("  " + "-+-".join("-" * w for w in widths))
    for r in rows:
        print("  " + " | ".join(str(r[h]).ljust(w) for h, w in zip(headers, widths)))


def _section(title: str):
    print(f"\n{'=' * 78}\n {title}\n{'=' * 78}")


def print_report(rep: dict[str, Any]):
    _section("世界模型框架历史表现分析报告")
    m = rep["metadata"]
    print(f"\n数据库: {m['database_path']}\n分析时间: {m['analysis_time']}")

    o = rep["overall"]
    _section("1. 总体统计")
    print(f"  学习运行数: {o.get('runs', 0):,}   唯一任务: {o.get('tasks', 0):,}   "
          f"会话: {o.get('sessions', 0):,}   可学习: {o.get('eligible', 0) or 0:,}")
    print(f"  时间范围: {o.get('earliest', 'N/A')}  ~  {o.get('latest', 'N/A')}")

    _section("2. 最终状态 (成功率)")
    _table(rep["final_status"])
    _section("3. 验证结果 (质量含金量)")
    _table(rep["verification"])
    _section("4. 成本等级")
    _table(rep["cost_class"])
    _section("5. 框架自评判断")
    for dim, rows in rep["judgments"].items():
        print(f"  [{dim}]")
        _table(rows)
    _section("6. 执行路由 / 平面")
    _table(rep["routes"])
    _section("7. 置信度区间")
    _table(rep["confidence_bands"])
    _section("8. 用户反馈信号")
    _table(rep["user_signals"])
    _section("9. 学习资格 × Δ状态")
    _table(rep["learning_state"])
    _section("10. 策略调整 (方向/决策点)")
    _table(rep["policy_deltas"])
    _section("11. 按周趋势")
    _table(rep["weekly_trend"])
    _section("12. 高频任务指纹 Top 12")
    _table(rep["top_fingerprints"])
    _section("13. 策略先验成熟度")
    _table(rep["prior_maturity"])
    _section("14. 最成熟先验 Top 10")
    _table(rep["top_priors"])
    _section("15. 后验信号事件")
    _table(rep["posterior_signals"])
    _section("16. 进化信号 (辅助)")
    _table(rep["evolution_signals"])
    print(f"\n{'=' * 78}\n 分析完成\n{'=' * 78}\n")


def main():
    parser = argparse.ArgumentParser(
        description="世界模型框架历史表现分析工具 (只读)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("database", nargs="?", help="SQLite 数据库路径 (默认: 桌面应用 deeting.db)")
    parser.add_argument("--export-json", metavar="FILE", help="导出 JSON 报告")
    parser.add_argument("--export-csv", metavar="DIR", help="导出 CSV 数据到目录")
    args = parser.parse_args()

    db_path = args.database or default_db_path()

    try:
        with WorldModelAnalyzer(db_path) as az:
            rep = az.report()
            print_report(rep)

            if args.export_json:
                Path(args.export_json).write_text(
                    json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                print(f"✓ JSON 报告已导出: {args.export_json}")

            if args.export_csv:
                import csv

                out = Path(args.export_csv)
                out.mkdir(parents=True, exist_ok=True)
                for key, data in rep.items():
                    if isinstance(data, list) and data:
                        with open(out / f"{key}.csv", "w", newline="", encoding="utf-8") as f:
                            w = csv.DictWriter(f, fieldnames=list(data[0].keys()))
                            w.writeheader()
                            w.writerows(data)
                        print(f"✓ CSV 已导出: {out / f'{key}.csv'}")

    except FileNotFoundError as e:
        print(f"错误: {e}", file=sys.stderr)
        print(f"提示: 默认路径 {default_db_path()}", file=sys.stderr)
        print("可手动传入数据库路径作为第一个参数。", file=sys.stderr)
        sys.exit(1)
    except sqlite3.Error as e:
        print(f"数据库错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
