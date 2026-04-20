"use client"

import { Bot } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { Skeleton } from "@/ui/shadcn/skeleton"
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
} from "@/ui/common/glass-card"

type TaskAgentsSkeletonProps = {
  t: (key: string) => string
}

export function TaskAgentsSkeleton({ t }: TaskAgentsSkeletonProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} icon={Bot} />

      {/* Stats skeleton */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <GlassCard key={`stat-skel-${i}`} hover="none" className="overflow-hidden border-white/6">
            <GlassCardContent className="flex items-center gap-3.5">
              <Skeleton className="size-9 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-10" />
              </div>
            </GlassCardContent>
          </GlassCard>
        ))}
      </div>

      {/* Main layout skeleton */}
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <GlassCard hover="none" className="overflow-hidden border-white/6">
          <GlassCardHeader className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </GlassCardHeader>
          <GlassCardContent className="space-y-2 pt-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`list-skel-${i}`} className="space-y-2 rounded-xl border border-white/6 p-3.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </GlassCardContent>
        </GlassCard>

        <GlassCard hover="none" className="overflow-hidden border-white/6">
          <GlassCardHeader className="space-y-3">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3.5 w-64" />
          </GlassCardHeader>
          <GlassCardContent className="space-y-3 pt-3">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </GlassCardContent>
        </GlassCard>
      </div>
    </div>
  )
}

export function TaskAgentsUnsupported({ t }: { t: (key: string) => string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} icon={Bot} />
      <GlassCard hover="none" className="border-white/6">
        <GlassCardHeader>
          <h3 className="text-[15px] font-semibold text-[var(--foreground)]">
            {t("unsupported.title")}
          </h3>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            {t("unsupported.description")}
          </p>
        </GlassCardHeader>
      </GlassCard>
    </div>
  )
}
