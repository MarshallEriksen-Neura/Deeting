"use client";

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n-context";
import { useUserOverviewProviders } from "@/lib/swr/use-user-overview-metrics";

interface ProviderRankingCardProps {
  timeRange?: string;
  onProviderClick?: (providerId: string) => void;
  onRetry?: () => void;
}

/**
 * Provider 消耗排行榜卡片
 *
 * 职责：
 * - 显示按消耗排序的 Provider 列表
 * - 支持时间范围切换
 * - 显示消耗、请求量、成功率等指标
 * - 实现快捷链接导航
 *
 * 验证需求：2.1, 2.2, 2.3, 2.4
 * 验证属性：Property 4, 6, 7
 */
export function ProviderRankingCard({
  timeRange = "7d",
  onProviderClick,
  onRetry,
}: ProviderRankingCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const {
    providers,
    loading,
    error,
    refresh,
  } = useUserOverviewProviders({ time_range: timeRange as any, limit: 5 });

  // 排序 Provider 列表（按消耗降序）
  const sortedProviders = useMemo(() => {
    const items = providers?.items ?? [];
    return [...items].sort((a, b) => b.total_requests - a.total_requests);
  }, [providers]);

  // 计算排名和百分比
  const rankedProviders = useMemo(() => {
    return sortedProviders.map((provider, index) => ({
      ...provider,
      rank: index + 1,
    }));
  }, [sortedProviders]);

  // 格式化数字
  const formatNumber = (value: number): string => {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };

  // 格式化百分比
  const formatPercentage = (value: number): string => {
    return (value * 100).toFixed(1);
  };

  // 处理 Provider 行点击
  const handleProviderClick = (providerId: string) => {
    onProviderClick?.(providerId);
    // 导航到 Provider 管理页面
    router.push(`/dashboard/providers/${providerId}`);
  };

  // 处理重试
  const handleRetry = () => {
    refresh();
    onRetry?.();
  };

  // 加载状态
  if (loading && sortedProviders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("provider_ranking.title")}</CardTitle>
          <CardDescription>{t("overview.from_last_month")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-8" data-testid="skeleton" />
                <Skeleton className="h-4 w-24" data-testid="skeleton" />
                <Skeleton className="h-4 w-20" data-testid="skeleton" />
                <Skeleton className="h-4 w-20" data-testid="skeleton" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 错误状态
  if (error && sortedProviders.length === 0) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            {t("provider_ranking.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            {t("provider_ranking.error")}
          </p>
          <Button size="sm" variant="outline" onClick={handleRetry}>
            {t("consumption.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 无数据状态
  if (sortedProviders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("provider_ranking.title")}</CardTitle>
          <CardDescription>{t("overview.from_last_month")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            {t("provider_ranking.no_data")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">{t("provider_ranking.title")}</CardTitle>
          <Badge variant="outline" className="h-5 text-xs font-normal">
            {sortedProviders.length}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {rankedProviders.slice(0, 5).map((provider) => (
            <div
              key={provider.provider_id}
              className="flex items-center gap-4 py-2 cursor-pointer hover:bg-muted/30 -mx-2 px-2 rounded transition-colors"
              onClick={() => handleProviderClick(provider.provider_id)}
              data-testid={`provider-row-${provider.provider_id}`}
            >
              {/* 排名 */}
              <div className="w-6 text-center">
                <span className="text-sm font-light text-muted-foreground">
                  {provider.rank}
                </span>
              </div>

              {/* Provider 名称 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {provider.provider_id}
                </p>
              </div>

              {/* 请求数 */}
              <div className="text-right">
                <p className="text-sm font-light">
                  {formatNumber(provider.total_requests)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("provider_ranking.requests")}
                </p>
              </div>

              {/* 成功率 */}
              <div className="w-16 text-right">
                <span
                  className={`text-xs font-medium ${
                    provider.success_rate >= 0.95
                      ? "text-foreground"
                      : provider.success_rate >= 0.9
                        ? "text-muted-foreground"
                        : "text-destructive"
                  }`}
                >
                  {formatPercentage(provider.success_rate)}%
                </span>
              </div>

              {/* 延迟 */}
              <div className="w-20 text-right text-xs text-muted-foreground">
                {provider.latency_p95_ms != null ? `${Math.round(provider.latency_p95_ms)}ms` : "--"}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
