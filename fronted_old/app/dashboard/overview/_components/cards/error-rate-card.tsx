"use client";

import { AlertTriangle } from "lucide-react";
import { AdaptiveCard, CardHeader, CardTitle, CardContent } from "@/components/cards/adaptive-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n-context";
import { cn } from "@/lib/utils";

interface ErrorRateCardProps {
  value: number;
  isLoading: boolean;
  error?: Error;
}

/**
 * 错误率 KPI 卡片
 * 
 * 职责：
 * - 显示错误率指标
 * - 处理加载态和错误态
 * - 格式化百分比显示
 * - 根据错误率高低显示不同颜色
 * 
 * 验证需求：1.1, 1.5
 */
export function ErrorRateCard({ value, isLoading, error }: ErrorRateCardProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <AdaptiveCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            {t("dashboard_v2.kpi.error_rate")}
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
            <AlertTriangle className="h-4 w-4" />
            {t("dashboard_v2.kpi.error_rate")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{t("dashboard_v2.error")}</p>
        </CardContent>
      </AdaptiveCard>
    );
  }

  // 根据错误率确定颜色
  const errorRateColor = getErrorRateColor(value);

  return (
    <AdaptiveCard>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <AlertTriangle className="h-4 w-4" />
          {t("dashboard_v2.kpi.error_rate")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", errorRateColor)}>
          {formatPercentage(value)}
        </div>
      </CardContent>
    </AdaptiveCard>
  );
}

/**
 * 格式化百分比显示
 */
function formatPercentage(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/**
 * 根据错误率获取颜色类名
 */
function getErrorRateColor(rate: number): string {
  if (rate < 0.01) {
    // < 1%: 正常（绿色）
    return "text-green-600 dark:text-green-400";
  } else if (rate < 0.05) {
    // 1-5%: 警告（黄色）
    return "text-yellow-600 dark:text-yellow-400";
  } else {
    // > 5%: 异常（红色）
    return "text-red-600 dark:text-red-400";
  }
}
