"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface ViewCardProps {
  title?: string
  viewType?: string
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function ViewCard({
  title,
  viewType,
  children,
  className,
  contentClassName,
}: ViewCardProps) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden border [border-color:rgba(15,17,28,0.08)] dark:[border-color:rgba(255,255,255,0.08)]",
        className
      )}
    >
      {(title || viewType) && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b [border-color:rgba(15,17,28,0.08)] dark:[border-color:rgba(255,255,255,0.08)]">
          <span className="truncate text-[12px] font-medium uppercase tracking-wider text-[#64748b] dark:text-[#94a3b8]">
            {title || viewType}
          </span>
        </div>
      )}
      <div className={cn("p-3", contentClassName)}>{children}</div>
    </div>
  )
}
