"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface BlueprintCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  subtitle?: string
  headerAction?: React.ReactNode
  showGrid?: boolean
}

export function BlueprintCard({
  title,
  subtitle,
  headerAction,
  showGrid = true,
  children,
  className,
  ...props
}: BlueprintCardProps) {
  return (
    <div 
      className={cn(
        "relative flex flex-col border border-[var(--border)] bg-[var(--card)]",
        "before:absolute before:-top-px before:-left-px before:size-3 before:border-l-2 before:border-t-2 before:border-[var(--muted-foreground)] before:opacity-30",
        "after:absolute after:-bottom-px after:-right-px after:size-3 after:border-r-2 after:border-b-2 after:border-[var(--muted-foreground)] after:opacity-30",
        className
      )}
      {...props}
    >
      {/* Background Grid */}
      {showGrid && (
        <div 
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]" 
          style={{
            backgroundImage: `linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)`,
            backgroundSize: '24px 24px'
          }}
        />
      )}

      {(title || subtitle || headerAction) && (
        <div className="relative z-10 flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex flex-col gap-0.5">
            {title && (
              <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-[var(--foreground)]">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="font-mono text-[9px] text-[var(--muted-foreground)] uppercase">
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && <div className="flex items-center">{headerAction}</div>}
        </div>
      )}

      <div className="relative z-10 flex-1 p-4">
        {children}
      </div>
      
      {/* Decorative footer line */}
      <div className="h-1 w-full bg-[var(--border)] opacity-30" />
    </div>
  )
}
