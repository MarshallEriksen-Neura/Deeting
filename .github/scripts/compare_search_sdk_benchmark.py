#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import sys

NON_DECREASING_METRICS = [
    "top1_accuracy",
    "top3_coverage",
    "lane_accuracy",
    "intent_accuracy",
    "domain_accuracy",
]
NON_INCREASING_METRICS = ["false_positive_rate"]
EPSILON = 1e-9


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def case_index(summary: dict) -> dict:
    return {case["query"]: case for case in summary.get("cases", [])}


def compare_metrics(baseline: dict, current: dict) -> tuple[list[dict], list[str]]:
    metrics = []
    regressions = []
    for name in NON_DECREASING_METRICS:
        base = float(baseline.get(name, 0.0))
        cur = float(current.get(name, 0.0))
        delta = cur - base
        regressed = cur + EPSILON < base
        metrics.append(
            {
                "metric": name,
                "baseline": base,
                "current": cur,
                "delta": delta,
                "direction": "non_decreasing",
                "regressed": regressed,
            }
        )
        if regressed:
            regressions.append(
                f"metric {name} regressed: baseline={base:.4f}, current={cur:.4f}"
            )
    for name in NON_INCREASING_METRICS:
        base = float(baseline.get(name, 0.0))
        cur = float(current.get(name, 0.0))
        delta = cur - base
        regressed = cur > base + EPSILON
        metrics.append(
            {
                "metric": name,
                "baseline": base,
                "current": cur,
                "delta": delta,
                "direction": "non_increasing",
                "regressed": regressed,
            }
        )
        if regressed:
            regressions.append(
                f"metric {name} regressed: baseline={base:.4f}, current={cur:.4f}"
            )
    return metrics, regressions


def compare_cases(baseline: dict, current: dict) -> tuple[list[dict], list[str]]:
    baseline_cases = case_index(baseline)
    current_cases = case_index(current)
    comparisons = []
    regressions = []

    baseline_queries = set(baseline_cases)
    current_queries = set(current_cases)
    missing = sorted(baseline_queries - current_queries)
    extra = sorted(current_queries - baseline_queries)
    if missing:
        regressions.append(f"missing benchmark queries in current run: {missing}")
    if extra:
        regressions.append(f"new benchmark queries missing from baseline: {extra}")

    for query in sorted(baseline_queries & current_queries):
        base = baseline_cases[query]
        cur = current_cases[query]
        case_regressions = []
        if base.get("lane_match") and not cur.get("lane_match"):
            case_regressions.append("lane_match dropped from true to false")
        if base.get("found_in_top3") and not cur.get("found_in_top3"):
            case_regressions.append("found_in_top3 dropped from true to false")
        if not base.get("false_positive") and cur.get("false_positive"):
            case_regressions.append("false_positive flipped from false to true")
        expected_name = base.get("expected_name")
        baseline_top1_hit = base.get("top1_name") == expected_name
        current_top1_hit = cur.get("top1_name") == expected_name
        if baseline_top1_hit and not current_top1_hit:
            case_regressions.append(
                f"top1 hit regressed from {base.get('top1_name')} to {cur.get('top1_name')}"
            )
        comparisons.append(
            {
                "query": query,
                "expected_name": expected_name,
                "baseline": {
                    "top1_name": base.get("top1_name"),
                    "found_rank": base.get("found_rank"),
                    "found_in_top3": base.get("found_in_top3"),
                    "lane_match": base.get("lane_match"),
                    "false_positive": base.get("false_positive"),
                },
                "current": {
                    "top1_name": cur.get("top1_name"),
                    "found_rank": cur.get("found_rank"),
                    "found_in_top3": cur.get("found_in_top3"),
                    "lane_match": cur.get("lane_match"),
                    "false_positive": cur.get("false_positive"),
                },
                "regressions": case_regressions,
            }
        )
        regressions.extend([f"{query}: {item}" for item in case_regressions])

    return comparisons, regressions


def write_report(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--report", required=False)
    args = parser.parse_args()

    baseline_path = Path(args.baseline)
    current_path = Path(args.current)
    baseline = load_json(baseline_path)
    current = load_json(current_path)

    metric_comparisons, metric_regressions = compare_metrics(baseline, current)
    case_comparisons, case_regressions = compare_cases(baseline, current)
    regressions = metric_regressions + case_regressions
    passed = not regressions

    report = {
        "passed": passed,
        "baseline_path": str(baseline_path),
        "current_path": str(current_path),
        "metric_comparisons": metric_comparisons,
        "case_comparisons": case_comparisons,
        "regressions": regressions,
    }

    if args.report:
        write_report(Path(args.report), report)

    print("search_sdk benchmark baseline diff")
    print(f"- baseline: {baseline_path}")
    print(f"- current: {current_path}")
    print(f"- passed: {passed}")
    for metric in metric_comparisons:
        print(
            f"  - {metric['metric']}: baseline={metric['baseline']:.4f}, current={metric['current']:.4f}, delta={metric['delta']:+.4f}"
        )
    if regressions:
        print("regressions detected:")
        for item in regressions:
            print(f"  - {item}")
        return 1
    print("no regressions detected")
    return 0


if __name__ == "__main__":
    sys.exit(main())