import * as React from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  actions?: React.ReactNode
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8", className)} {...props}>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl flex items-center gap-3">
          {Icon && <Icon className="size-7 text-[var(--primary)]" />}
          {title}
        </h1>
        {description && <p className="text-[var(--muted)]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
