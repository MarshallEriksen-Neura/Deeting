import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * VideoSkeleton - 视频功能加载骨架屏
 * 用于视频生成界面初始加载时的占位显示
 *
 * @component
 * @example
 * ```tsx
 * <VideoSkeleton />
 * ```
 */
export const VideoSkeleton = React.memo(() => {
  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* Background noise texture */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.1),transparent_50%)] animate-pulse" />
      </div>

      {/* Left Input Dock Skeleton */}
      <div className="w-80 m-4 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 flex flex-col gap-6">
        <Skeleton className="w-24 h-6 mb-6" />
        <div className="space-y-4">
          <Skeleton className="w-full h-32 rounded-xl" />
          <Skeleton className="w-full h-24 rounded-lg" />
        </div>
        <div className="space-y-3 mt-auto">
          <Skeleton className="w-full h-12 rounded-lg" />
          <Skeleton className="w-full h-12 rounded-lg" />
          <Skeleton className="w-full h-12 rounded-lg" />
        </div>
        <Skeleton className="w-full h-12 rounded-xl mt-auto" />
      </div>

      {/* Main Content Area Skeleton */}
      <div className="flex-1 p-4 flex flex-col">
        <div className="flex-1 bg-black/40 rounded-3xl relative overflow-hidden flex items-center justify-center">
          <div className="text-center space-y-4">
            <Skeleton className="w-24 h-24 rounded-full mx-auto" />
            <div className="space-y-2">
              <Skeleton className="w-32 h-6 mx-auto" />
              <Skeleton className="w-48 h-4 mx-auto" />
            </div>
          </div>
        </div>

        {/* Bottom Memory Bridge Skeleton */}
        <div className="h-48 mt-4 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
          <Skeleton className="w-32 h-5 mb-4" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="w-full aspect-video rounded-lg" />
                <Skeleton className="w-3/4 h-3 rounded" />
                <Skeleton className="w-1/2 h-3 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})

VideoSkeleton.displayName = "VideoSkeleton"