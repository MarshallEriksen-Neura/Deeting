"use client";

import { Clock } from "lucide-react";
import { AdaptiveCard, CardHeader, CardTitle, CardContent } from "@/components/cards/adaptive-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n-context";

interface LatencyP95CardProps {
  value: number;
  isLoading: boolean;
  error?: Error;
}

/**
 * P95 延迟 KPI 卡片
 * 
 * 职责：
 * - 显示 P95 延迟指标
 * - 处理加载态和错误态
 * - 格式化延迟显示（毫秒单位）
 * 
 * 验证需求：1.1, 1.5
 */
export function LatencyP95Card({ value, isLoading, error }: LatencyP95CardProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <AdaptiveCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Clock className="h-4 w-4" />
            {t("dashboard_v2.kpi.latency_p95")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </AdaptiveCard>
    );
  }

  if (error) {
    return (
      <AdaptiveCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Clock className="h-4 w-4" />
            {t("dashboard_v2.kpi.latency_p95")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{t("dashboard_v2.error")}</p>
        </CardContent>
      </AdaptiveCard>
    );
  }

  return (
    <AdaptiveCard>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Clock className="h-4 w-4" />
          {t("dashboard_v2.kpi.latency_p95")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {formatLatency(value)}
        </div>
      </CardContent>
    </AdaptiveCard>
  );
}

/**
 * 格式化延迟显示（毫秒单位）
 */
function formatLatency(ms: number): string {
  return `${ms.toLocaleString()} ms`;
}
