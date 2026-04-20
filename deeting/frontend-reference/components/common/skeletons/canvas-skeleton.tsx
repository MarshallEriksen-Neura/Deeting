import React from "react"

/**
 * CanvasSkeleton - 画布加载骨架屏
 * 用于画布容器初始加载时的占位显示
 * 
 * @component
 * @example
 * ```tsx
 * <CanvasSkeleton />
 * ```
 */
export const CanvasSkeleton = React.memo(() => {
  return (
     <div className="w-full h-full flex flex-col items-center justify-center bg-transparent">
         {/* Simple placeholder for initial load */}
         <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="h-8 w-48 bg-slate-200/70 dark:bg-white/10 rounded-lg" />
            <div className="h-4 w-32 bg-slate-200/70 dark:bg-white/10 rounded-lg" />
         </div>
     </div>
  )
})

CanvasSkeleton.displayName = "CanvasSkeleton"
