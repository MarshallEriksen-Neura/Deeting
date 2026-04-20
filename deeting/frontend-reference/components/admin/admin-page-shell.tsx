"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface AdminPageShellProps {
  title: string
  description?: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function AdminPageShell({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: AdminPageShellProps) {
  const renderedIcon = React.isValidElement<{ className?: string }>(icon)
    ? React.cloneElement(icon, {
        className: cn("size-5 text-[var(--primary)]", icon.props.className),
      })
    : icon

  return (
    <div className={cn("flex-1 space-y-6 p-6", className)}>
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {renderedIcon && (
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--primary)]/10">
              {renderedIcon}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-[var(--muted)]">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {/* Page Content */}
      {children}
    </div>
  )
}
