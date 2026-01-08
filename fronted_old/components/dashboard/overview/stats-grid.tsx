"use client";

import { useMemo } from "react";
import { Activity, Server, Database } from "lucide-react";
import { StatCard } from "../common";
import { useUserOverviewSummary, UserOverviewTimeRange } from "@/lib/swr/use-user-overview-metrics";

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function computeChange(
  current: number,
  previous: number | null
): { text: string; trend: "up" | "down" } {
  if (previous === null || previous <= 0) {
    // 没有上一周期数据时，仅展示当前值，不标明显著涨跌
    return { text: "--", trend: "up" };
  }
  const delta = (current - previous) / previous;
  const percent = (delta * 100).toFixed(1);
  const trend: "up" | "down" = delta >= 0 ? "up" : "down";
  const sign = delta >= 0 ? "+" : "";
  return { text: `${sign}${percent}%`, trend };
}

interface StatsGridProps {
  timeRange?: UserOverviewTimeRange;
}

export function StatsGrid({ timeRange = "today" }: StatsGridProps) {
  // 根据传入的时间范围获取数据
  const { summary } = useUserOverviewSummary({ time_range: timeRange });

  const cards = useMemo(() => {
    if (!summary) {
      // 初始加载或发生错误时保留占位布局
      return [
        {
          titleKey: "overview.total_requests",
          value: "--",
          change: "--",
          trend: "up" as const,
          icon: Activity,
        },
        {
          titleKey: "overview.active_providers",
          value: "--",
          change: "--",
          trend: "up" as const,
          icon: Server,
        },
        {
          titleKey: "overview.success_rate",
          value: "--",
          change: "--",
          trend: "up" as const,
          icon: Database,
        },
      ];
    }

    const totalChange = computeChange(summary.total_requests, summary.total_requests_prev);
    const providerChange = computeChange(summary.active_providers, summary.active_providers_prev);
    const successChange = computeChange(summary.success_rate, summary.success_rate_prev);

    return [
      {
        titleKey: "overview.my_total_requests",
        value: formatNumber(summary.total_requests),
        change: totalChange.text,
        trend: totalChange.trend,
        icon: Activity,
      },
      {
        titleKey: "overview.my_active_providers",
        value: summary.active_providers.toString(),
        change: providerChange.text,
        trend: providerChange.trend,
        icon: Server,
      },
      {
        titleKey: "overview.my_success_rate",
        value: formatPercent(summary.success_rate),
        change: successChange.text,
        trend: successChange.trend,
        icon: Database,
      },
    ];
  }, [summary]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cards.map((stat, index) => (
        <StatCard
          key={index}
          titleKey={stat.titleKey}
          value={stat.value}
          change={stat.change}
          trend={stat.trend}
          icon={stat.icon}
        />
      ))}
    </div>
  );
}
