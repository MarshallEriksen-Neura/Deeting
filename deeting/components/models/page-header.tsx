import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
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
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", className)} {...props}>
      <div className="space-y-1">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-[-0.04em] text-[var(--ink)] md:text-3xl">
          {Icon ? <Icon className="size-7 text-[var(--accent-strong)]" /> : null}
          {title}
        </h1>
        {description ? <p className="text-sm text-[var(--ink-2)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
