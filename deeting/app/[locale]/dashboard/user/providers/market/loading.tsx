import { Loader2 } from "lucide-react"

export default function ProviderMarketSkeleton() {
  return (
    <div className="space-y-8">
      {/* Header Skeleton */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-8 w-48 bg-[var(--surface)] rounded animate-pulse" />
            <div className="h-4 w-64 bg-[var(--surface)] rounded animate-pulse" />
          </div>
          <div className="h-10 w-80 bg-[var(--surface)] rounded animate-pulse" />
        </div>
        
        {/* Tabs Skeleton */}
        <div className="h-12 w-full bg-[var(--surface)] rounded-xl animate-pulse" />
      </div>

      {/* Loading State */}
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted)]" />
        <span className="ml-2 text-[var(--muted)]">Loading providers...</span>
      </div>
    </div>
  )
}