"use client";

import { RequestsErrorsChart } from "./requests-errors-chart";
import { useUserDashboardPulse } from "@/lib/swr/use-dashboard-v2";

interface RequestsErrorsChartLiveProps {
  transport?: "all" | "http" | "sdk" | "claude_cli";
  isStream?: "all" | "true" | "false";
}

/**
 * 实时请求 & 错误趋势图表（连接真实 API）
 */
export function RequestsErrorsChartLive({
  transport = "all",
  isStream = "all",
}: RequestsErrorsChartLiveProps) {
  const { points, loading, error } = useUserDashboardPulse({
    transport,
    isStream,
  });

  return <RequestsErrorsChart data={points} isLoading={loading} error={error} />;
}
