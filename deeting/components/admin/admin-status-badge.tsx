"use client"

import { cn } from "@/lib/utils"

type BadgeTone = "default" | "info" | "success" | "warn" | "error" | "primary" | "teal" | "amber"

interface AdminStatusBadgeProps {
  text: string
  tone?: BadgeTone
  dot?: boolean
  className?: string
}

const toneStyles: Record<BadgeTone, string> = {
  default:
    "text-white/60 bg-white/10 border-white/10",
  info: "text-blue-300 bg-blue-500/10 border-blue-400/20",
  success:
    "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
  warn: "text-amber-300 bg-amber-500/10 border-amber-400/20",
  error:
    "text-rose-300 bg-rose-500/10 border-rose-400/20",
  primary:
    "text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/20",
  teal: "text-teal-300 bg-teal-500/10 border-teal-400/20",
  amber: "text-amber-300 bg-amber-500/10 border-amber-400/20",
}

const dotStyles: Record<BadgeTone, string> = {
  default: "bg-white/40",
  info: "bg-blue-400",
  success: "bg-emerald-400",
  warn: "bg-amber-400",
  error: "bg-rose-400",
  primary: "bg-[var(--primary)]",
  teal: "bg-teal-400",
  amber: "bg-amber-400",
}

export function AdminStatusBadge({
  text,
  tone = "default",
  dot = true,
  className,
}: AdminStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-none",
        toneStyles[tone],
        className
      )}
    >
      {dot && (
        <span
          className={cn("size-1.5 rounded-full", dotStyles[tone])}
        />
      )}
      {text}
    </span>
  )
}

// Utility function for mapping common statuses to tones
export function getStatusTone(status: string): BadgeTone {
  const map: Record<string, BadgeTone> = {
    // General
    active: "success",
    enabled: "success",
    healthy: "success",
    up: "success",
    online: "success",
    published: "success",
    approved: "success",
    completed: "success",
    succeeded: "success",
    success: "success",
    committed: "success",

    // Warning
    pending: "warn",
    needs_review: "warn",
    pending_review: "warn",
    pending_signal: "warn",
    pending_eval: "warn",
    draft: "warn",
    queued: "warn",
    paused: "warn",
    degraded: "warn",
    waiting_approval: "warn",
    running: "info",

    // Error
    inactive: "error",
    disabled: "error",
    revoked: "error",
    expired: "error",
    failed: "error",
    rejected: "error",
    banned: "error",
    suspended: "error",
    down: "error",
    offline: "error",
    canceled: "error",
    reversed: "error",

    // Info
    processing: "info",
    indexed: "info",
    archived: "info",
    closed: "info",
    skipped: "default",

    // Special
    internal: "primary",
    external: "teal",
    private: "default",
    unlisted: "info",
    public: "success",
  }
  return map[status.toLowerCase()] ?? "default"
}
