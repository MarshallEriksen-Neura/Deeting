import React from "react"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * VoiceSkeleton - 语音功能加载骨架屏
 * 用于语音工具栏初始加载时的占位显示
 * 
 * @component
 * @example
 * ```tsx
 * <VoiceSkeleton />
 * ```
 */
export const VoiceSkeleton = React.memo(() => {
  return (
    <div className="relative flex flex-col items-center p-6 min-h-[160px] bg-gradient-to-b from-red-950/20 to-transparent">
       <div className="absolute top-4 right-4">
          <Skeleton className="w-4 h-4 rounded" />
       </div>
       <div className="flex items-center gap-2 mb-6">
          <Skeleton className="w-24 h-4 rounded-full" />
       </div>
       <div className="h-24 mb-6 w-full max-w-sm flex items-center justify-center gap-1">
          {Array.from({ length: 10 }).map((_, i) => (
             <Skeleton key={i} className="w-1 h-8 rounded-full bg-white/10" />
          ))}
       </div>
       <div className="flex items-center gap-4">
          <Skeleton className="w-20 h-20 rounded-full" />
       </div>
    </div>
  )
})

VoiceSkeleton.displayName = "VoiceSkeleton"
