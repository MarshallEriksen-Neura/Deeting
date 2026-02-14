"use client"

import { useTranslations } from "next-intl"
import { GlassCard } from "@/components/ui/glass-card"

interface SkeletonProps {
  /**
   * 骨架类型
   */
  variant?: "card" | "table" | "stats" | "form" | "chart"
  /**
   * 自定义类名
   */
  className?: string
  /**
   * 行数 (用于表格/列表)
   */
  rows?: number
  /**
   * 列数 (用于统计卡片)
   */
  columns?: number
}

/**
 * 通用骨架加载组件
 */
export function AdminSkeleton({
  variant = "card",
  className = "",
  rows = 5,
  columns = 4,
}: SkeletonProps) {
  const baseClass =
    "animate-pulse rounded-lg bg-white/[0.05]"

  switch (variant) {
    case "stats":
      return (
        <div
          className={`grid gap-4 lg:grid-cols-${columns}`}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, i) => (
            <GlassCard key={i} padding="default" hover="none">
              <div className="space-y-3">
                <div className={`${baseClass} h-4 w-16`} />
                <div className={`${baseClass} h-8 w-24`} />
                <div className={`${baseClass} h-3 w-20`} />
              </div>
            </GlassCard>
          ))}
        </div>
      )

    case "table":
      return (
        <GlassCard padding="default" hover="none" className={className}>
          <div className="space-y-3">
            {/* 表头 */}
            <div className="flex gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`${baseClass} h-4 flex-1`} />
              ))}
            </div>
            {/* 表格行 */}
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex gap-4">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className={`${baseClass} h-8 flex-1`} />
                ))}
              </div>
            ))}
          </div>
        </GlassCard>
      )

    case "form":
      return (
        <GlassCard padding="default" hover="none" className={className}>
          <div className="space-y-4">
            <div className={`${baseClass} h-10 w-full`} />
            <div className={`${baseClass} h-10 w-full`} />
            <div className={`${baseClass} h-10 w-32`} />
          </div>
        </GlassCard>
      )

    case "chart":
      return (
        <GlassCard padding="default" hover="none" className={className}>
          <div className="space-y-4">
            <div className={`${baseClass} h-6 w-32`} />
            <div className={`${baseClass} h-48 w-full`} />
          </div>
        </GlassCard>
      )

    default:
      return <div className={`${baseClass} h-32 w-full ${className}`} />
  }
}

/**
 * 页面级别骨架 - 完整的页面加载状态
 */
interface PageSkeletonProps {
  /**
   * 页面标题 (可选)
   */
  title?: string
  /**
   * 页面描述 (可选)
   */
  description?: string
  /**
   * 是否显示统计卡片
   */
  showStats?: boolean
  /**
   * 是否显示表单
   */
  showForm?: boolean
  /**
   * 是否显示表格
   */
  showTable?: boolean
  /**
   * 表格行数
   */
  tableRows?: number
  /**
   * 统计卡片列数
   */
  statsColumns?: number
}

export function AdminPageSkeleton({
  title,
  description,
  showStats = true,
  showForm = false,
  showTable = true,
  tableRows = 5,
  statsColumns = 4,
}: PageSkeletonProps) {
  const t = useTranslations("admin")
  const resolvedTitle = title ?? t("common.loading")
  const resolvedDescription = description ?? t("dashboard.loadingDescription")

  return (
    <div className="space-y-4">
      <div className="sr-only">
        {resolvedTitle} - {resolvedDescription}
      </div>
      {/* 页面标题 */}
      <div className="mb-6">
        <div className="animate-pulse h-8 w-48 rounded-lg bg-white/[0.05]" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded-lg bg-white/[0.05]" />
      </div>

      {/* 统计卡片 */}
      {showStats && (
        <AdminSkeleton variant="stats" columns={statsColumns} />
      )}

      {/* 表单 */}
      {showForm && <AdminSkeleton variant="form" />}

      {/* 表格 */}
      {showTable && (
        <AdminSkeleton variant="table" rows={tableRows} />
      )}
    </div>
  )
}

/**
 * 统计卡片骨架
 */
export function StatCardSkeleton() {
  return (
    <GlassCard padding="default" hover="none">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-4 w-16 animate-pulse rounded-lg bg-white/[0.05]" />
          <div className="h-8 w-8 animate-pulse rounded-lg bg-white/[0.05]" />
        </div>
        <div className="h-8 w-20 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="h-3 w-24 animate-pulse rounded-lg bg-white/[0.05]" />
      </div>
    </GlassCard>
  )
}

/**
 * 列表项骨架
 */
export function ListItemSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded-lg bg-white/[0.05]" />
          <div className="h-3 w-24 animate-pulse rounded-lg bg-white/[0.05]" />
        </div>
      </div>
      <div className="h-4 w-16 animate-pulse rounded-lg bg-white/[0.05]" />
    </div>
  )
}

/**
 * 图表骨架
 */
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-lg bg-white/[0.02]"
      style={{ height }}
    >
      <div className="flex h-full items-end justify-around gap-2 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="w-full animate-pulse rounded-t bg-white/[0.1]"
            style={{
              height: `${((i * 17) % 60) + 20}%`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
