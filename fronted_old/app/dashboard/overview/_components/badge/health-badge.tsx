"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n-context";
import { cn } from "@/lib/utils";

/**
 * 健康状态类型
 */
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

/**
 * 健康状态徽章组件的 Props
 */
export interface HealthBadgeProps {
  /**
   * 错误率（0-100 的百分比）
   */
  errorRate: number;
  /**
   * P95 延迟（毫秒）
   */
  latencyP95Ms: number;
  /**
   * 是否正在加载
   */
  isLoading?: boolean;
  /**
   * 自定义类名
   */
  className?: string;
}

/**
 * 根据错误率和延迟推导健康状态
 * 
 * 规则：
 * - 正常：错误率 < 1% 且 P95 延迟 < 1000ms
 * - 抖动：错误率在 1-5% 或 P95 延迟明显升高（1000-3000ms）
 * - 异常：错误率 > 5% 或 P95 延迟 > 3000ms
 */
function deriveHealthStatus(errorRate: number, latencyP95Ms: number): HealthStatus {
  // 异常：错误率 > 5% 或延迟 > 3000ms
  if (errorRate > 5 || latencyP95Ms > 3000) {
    return "unhealthy";
  }
  
  // 抖动：错误率在 1-5% 或延迟在 1000-3000ms
  if (errorRate >= 1 || latencyP95Ms >= 1000) {
    return "degraded";
  }
  
  // 正常：错误率 < 1% 且延迟 < 1000ms
  return "healthy";
}

/**
 * 获取健康状态的样式类名
 */
function getHealthStatusClassName(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-green-200 dark:border-green-800";
    case "degraded":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-200 dark:border-yellow-800";
    case "unhealthy":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-200 dark:border-red-800";
  }
}

/**
 * 健康状态徽章组件
 * 
 * 根据错误率和 P95 延迟显示系统健康状态：
 * - 正常（绿色）：错误率 < 1% 且 P95 延迟 < 1000ms
 * - 抖动（黄色）：错误率在 1-5% 或 P95 延迟明显升高
 * - 异常（红色）：错误率 > 5% 或延迟过高
 * 
 * @example
 * ```tsx
 * <HealthBadge errorRate={0.5} latencyP95Ms={800} />
 * ```
 */
export function HealthBadge({
  errorRate,
  latencyP95Ms,
  isLoading = false,
  className,
}: HealthBadgeProps) {
  const { t } = useI18n();
  
  // 加载中显示占位符
  if (isLoading) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "animate-pulse bg-muted text-muted-foreground",
          className
        )}
      >
        {t("dashboardV2.healthBadge.loading")}
      </Badge>
    );
  }
  
  // 推导健康状态
  const status = deriveHealthStatus(errorRate, latencyP95Ms);
  
  // 获取状态文案
  const statusText = {
    healthy: t("dashboardV2.healthBadge.healthy"),
    degraded: t("dashboardV2.healthBadge.degraded"),
    unhealthy: t("dashboardV2.healthBadge.unhealthy"),
  }[status];
  
  return (
    <Badge
      variant="outline"
      className={cn(
        getHealthStatusClassName(status),
        "font-medium",
        className
      )}
    >
      {statusText}
    </Badge>
  );
}
