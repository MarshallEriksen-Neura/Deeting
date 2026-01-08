"use client";

import { DollarSign } from "lucide-react";
import { AdaptiveCard, CardHeader, CardTitle, CardContent } from "@/components/cards/adaptive-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n-context";

interface CreditsSpentCardProps {
  value: number;
  isLoading: boolean;
  error?: Error;
}

/**
 * Credits 花费 KPI 卡片
 * 
 * 职责：
 * - 显示 Credits 花费指标
 * - 处理加载态和错误态
 * - 格式化 Credits 显示（保留 2 位小数）
 * 
 * 验证需求：1.1, 1.3, 1.5
 */
export function CreditsSpentCard({ value, isLoading, error }: CreditsSpentCardProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <AdaptiveCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            {t("dashboard_v2.kpi.credits_spent")}
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
            <DollarSign className="h-4 w-4" />
            {t("dashboard_v2.kpi.credits_spent")}
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
          <DollarSign className="h-4 w-4" />
          {t("dashboard_v2.kpi.credits_spent")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {formatCredits(value)}
        </div>
      </CardContent>
    </AdaptiveCard>
  );
}

/**
 * 格式化 Credits 显示（保留 2 位小数，添加千位分隔符）
 */
function formatCredits(credits: number): string {
  return credits.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
