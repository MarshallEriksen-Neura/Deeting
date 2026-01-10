"use client";

import { Activity } from "lucide-react";
import { AdaptiveCard, CardHeader, CardTitle, CardContent } from "@/components/cards/adaptive-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n-context";

interface TotalRequestsCardProps {
  value: number;
  isLoading: boolean;
  error?: Error;
}

/**
 * 总请求数 KPI 卡片
 * 
 * 职责：
 * - 显示总请求数指标
 * - 处理加载态和错误态
 * - 格式化大数字显示
 * 
 * 验证需求：1.1, 1.5
 */
export function TotalRequestsCard({ value, isLoading, error }: TotalRequestsCardProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <AdaptiveCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Activity className="h-4 w-4" />
            {t("dashboard_v2.kpi.total_requests")}
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
            <Activity className="h-4 w-4" />
            {t("dashboard_v2.kpi.total_requests")}
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
          <Activity className="h-4 w-4" />
          {t("dashboard_v2.kpi.total_requests")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {formatNumber(value)}
        </div>
      </CardContent>
    </AdaptiveCard>
  );
}

/**
 * 格式化数字显示（添加千位分隔符）
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}
