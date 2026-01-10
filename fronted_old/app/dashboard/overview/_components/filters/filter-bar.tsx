"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n-context";

// 时间范围类型
export type TimeRange = "today" | "7d" | "30d";

// 传输方式类型
export type Transport = "all" | "http" | "sdk" | "claude_cli";

// 流式类型
export type StreamFilter = "all" | "true" | "false";

interface FilterBarProps {
  timeRange: TimeRange;
  transport: Transport;
  isStream: StreamFilter;
  onTimeRangeChange: (range: TimeRange) => void;
  onTransportChange: (transport: Transport) => void;
  onStreamChange: (stream: StreamFilter) => void;
}

// 时间范围选项
const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; labelKey: string }> = [
  { value: "today", labelKey: "dashboard_v2.filter.time_range.today" },
  { value: "7d", labelKey: "dashboard_v2.filter.time_range.7d" },
  { value: "30d", labelKey: "dashboard_v2.filter.time_range.30d" },
];

// 传输方式选项
const TRANSPORT_OPTIONS: Array<{ value: Transport; labelKey: string }> = [
  { value: "all", labelKey: "dashboard_v2.filter.transport.all" },
  { value: "http", labelKey: "dashboard_v2.filter.transport.http" },
  { value: "sdk", labelKey: "dashboard_v2.filter.transport.sdk" },
  { value: "claude_cli", labelKey: "dashboard_v2.filter.transport.claude_cli" },
];

// 流式选项
const STREAM_OPTIONS: Array<{ value: StreamFilter; labelKey: string }> = [
  { value: "all", labelKey: "dashboard_v2.filter.stream.all" },
  { value: "true", labelKey: "dashboard_v2.filter.stream.true" },
  { value: "false", labelKey: "dashboard_v2.filter.stream.false" },
];

/**
 * Dashboard v2 筛选器组件
 *
 * 职责：
 * - 提供时间范围选择（today/7d/30d）
 * - 提供传输方式筛选（all/http/sdk/claude_cli）
 * - 提供流式筛选（all/true/false）
 * - 触发父组件的数据更新回调
 *
 * 验证需求：7.1, 7.4, 8.1, 8.2
 */
export function FilterBar({
  timeRange,
  transport,
  isStream,
  onTimeRangeChange,
  onTransportChange,
  onStreamChange,
}: FilterBarProps) {
  const { t } = useI18n();
  const [isHydrated, setIsHydrated] = useState(false);

  // 客户端水合完成标记
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // 处理时间范围变化
  const handleTimeRangeChange = (value: string) => {
    if (isValidTimeRange(value)) {
      onTimeRangeChange(value as TimeRange);
    }
  };

  // 处理传输方式变化
  const handleTransportChange = (value: string) => {
    if (isValidTransport(value)) {
      onTransportChange(value as Transport);
    }
  };

  // 处理流式筛选变化
  const handleStreamChange = (value: string) => {
    if (isValidStreamFilter(value)) {
      onStreamChange(value as StreamFilter);
    }
  };

  // 避免水合错误 - 显示加载占位符
  if (!isHydrated) {
    return (
      <div className="flex items-center gap-4 flex-wrap">
        <div className="h-10 w-32 bg-muted rounded animate-pulse" />
        <div className="h-10 w-32 bg-muted rounded animate-pulse" />
        <div className="h-10 w-32 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* 时间范围选择器 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t("dashboard_v2.filter.time_range.label")}
        </span>
        <Select value={timeRange} onValueChange={handleTimeRangeChange}>
          <SelectTrigger className="w-36 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 传输方式筛选器 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t("dashboard_v2.filter.transport.label")}
        </span>
        <Select value={transport} onValueChange={handleTransportChange}>
          <SelectTrigger className="w-36 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSPORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 流式筛选器 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t("dashboard_v2.filter.stream.label")}
        </span>
        <Select value={isStream} onValueChange={handleStreamChange}>
          <SelectTrigger className="w-36 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STREAM_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * 验证时间范围值是否有效
 */
function isValidTimeRange(value: unknown): value is TimeRange {
  return (
    typeof value === "string" && ["today", "7d", "30d"].includes(value)
  );
}

/**
 * 验证传输方式值是否有效
 */
function isValidTransport(value: unknown): value is Transport {
  return (
    typeof value === "string" &&
    ["all", "http", "sdk", "claude_cli"].includes(value)
  );
}

/**
 * 验证流式筛选值是否有效
 */
function isValidStreamFilter(value: unknown): value is StreamFilter {
  return (
    typeof value === "string" && ["all", "true", "false"].includes(value)
  );
}
