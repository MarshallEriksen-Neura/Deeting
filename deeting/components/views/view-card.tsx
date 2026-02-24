"use client"

import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ViewCardProps {
  title?: string
  viewType?: string
  children: ReactNode
  className?: string
}

export function ViewCard({ title, viewType, children, className }: ViewCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card overflow-hidden w-full max-w-lg",
        className
      )}
    >
      {(title || viewType) && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
          {title && (
            <span className="text-sm font-medium truncate">{title}</span>
          )}
          {viewType && (
            <Badge
              variant="outline"
              className="text-[10px] h-5 font-normal text-muted-foreground shrink-0"
            >
              {viewType}
            </Badge>
          )}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  )
}
