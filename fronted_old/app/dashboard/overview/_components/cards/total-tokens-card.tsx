"use client";

import { Coins } from "lucide-react";
import { AdaptiveCard, CardHeader, CardTitle, CardContent } from "@/components/cards/adaptive-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n-context";

interface TotalTokensCardProps {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  isLoading: boolean;
  error?: Error;
}

/**
 * Token 总量 KPI 卡片
 * 
 * 职责：
 * - 显示 Token 总量指标
 * - 分别显示输入 Token 和输出 Token
 * - 处理加载态和错误态
 * - 格式化大数字显示
 * 
 * 验证需求：1.1, 1.4, 1.5
 */
export function TotalTokensCard({
  inputTokens,
  outputTokens,
  totalTokens,
  isLoading,
  error,
}: TotalTokensCardProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <AdaptiveCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Coins className="h-4 w-4" />
            {t("dashboard_v2.kpi.total_tokens")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </AdaptiveCard>
    );
  }

  if (error) {
    return (
      <AdaptiveCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Coins className="h-4 w-4" />
            {t("dashboard_v2.kpi.total_tokens")}
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
          <Coins className="h-4 w-4" />
          {t("dashboard_v2.kpi.total_tokens")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold mb-2">
          {formatNumber(totalTokens)}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="text-blue-600 dark:text-blue-400">↓</span>
            <span>{t("dashboard_v2.kpi.input_tokens")}:</span>
            <span className="font-medium">{formatNumber(inputTokens)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-purple-600 dark:text-purple-400">↑</span>
            <span>{t("dashboard_v2.kpi.output_tokens")}:</span>
            <span className="font-medium">{formatNumber(outputTokens)}</span>
          </div>
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
