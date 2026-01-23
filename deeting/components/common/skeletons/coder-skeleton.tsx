import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * CoderSkeleton - 代码编辑器加载骨架屏
 * 用于代码编辑器/控制台初始加载时的占位显示
 * 
 * @component
 * @example
 * ```tsx
 * <CoderSkeleton />
 * ```
 */
export const CoderSkeleton = React.memo(() => {
  return (
    <div className="flex flex-col h-full p-0 bg-black/[0.02]">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-black/5">
        <div className="flex items-center gap-4">
           <Skeleton className="w-24 h-4" />
           <Skeleton className="w-32 h-3" />
        </div>
        <Skeleton className="w-4 h-4 rounded" />
      </div>
      
      {/* Body Skeleton */}
      <div className="flex-1 flex relative p-4">
         <div className="space-y-2 w-full">
            <Skeleton className="w-full h-4 opacity-50" />
            <Skeleton className="w-3/4 h-4 opacity-40" />
            <Skeleton className="w-1/2 h-4 opacity-30" />
         </div>
      </div>
      
      {/* Footer Skeleton */}
      <div className="px-4 py-2 border-t border-black/5 flex justify-between items-center">
        <div className="flex gap-2">
            <Skeleton className="w-20 h-6 rounded" />
            <Skeleton className="w-20 h-6 rounded" />
        </div>
        <Skeleton className="w-24 h-8 rounded" />
      </div>
    </div>
  )
})

CoderSkeleton.displayName = "CoderSkeleton"
