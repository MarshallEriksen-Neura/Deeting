import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * HudSkeleton - HUD 显示加载骨架屏
 * 用于 HUD 容器初始加载时的占位显示
 * 
 * @component
 * @example
 * ```tsx
 * <HudSkeleton />
 * ```
 */
export const HudSkeleton = React.memo(() => {
  return (
    <nav className="flex flex-col items-center gap-2 px-1 py-1 pointer-events-auto relative z-50">
      {/* Dynamic Island Skeleton */}
      <div className="flex items-center gap-3 px-4 py-2 rounded-full border border-white/5 bg-black/20 backdrop-blur-md h-[38px]">
         <div className="flex items-center gap-2">
            <Skeleton className="w-2.5 h-2.5 rounded-full" />
            <div className="flex flex-col gap-1">
                <Skeleton className="w-12 h-2" />
                <Skeleton className="w-16 h-3" />
            </div>
         </div>
         <div className="w-[1px] h-4 bg-white/10" />
         <div className="flex items-center gap-2">
            <Skeleton className="w-16 h-3" />
            <Skeleton className="w-4 h-4 rounded" />
         </div>
         <div className="w-[1px] h-4 bg-white/10" />
         <Skeleton className="w-6 h-6 rounded-full" />
      </div>
    </nav>
  )
})

HudSkeleton.displayName = "HudSkeleton"
