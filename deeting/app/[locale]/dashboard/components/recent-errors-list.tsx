"use client"

import { useTranslations } from "next-intl"
import { AlertCircle, ExternalLink } from "lucide-react"
import Link from "next/link"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useRecentErrors } from "@/lib/swr/use-recent-errors"

/**
 * Recent Errors List Component
 *
 * Displays the most recent error entries with:
 * - Timestamp
 * - HTTP status code
 * - Model name
 * - Error message snippet
 */
export function RecentErrorsList() {
  const t = useTranslations("dashboard.recentErrors")
  const { data: errors, isLoading } = useRecentErrors()

  return (
    <GlassCard className="h-full">
      <GlassCardHeader>
        <div className="flex items-start justify-between">
          <div>
            <GlassCardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-400" />
              {t("title")}
            </GlassCardTitle>
            <GlassCardDescription className="mt-1">
              {t("description")}
            </GlassCardDescription>
          </div>
          <Link href="/logs">
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--primary)] hover:text-[var(--primary)]/80"
            >
              {t("viewAll")}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </GlassCardHeader>
      <GlassCardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-[var(--foreground)]/5"
              />
            ))}
          </div>
        ) : errors && errors.length > 0 ? (
          <div className="space-y-2">
            {errors.map((error) => (
              <ErrorRow key={error.id} error={error} />
            ))}
          </div>
        ) : (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-[var(--muted)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <span className="text-2xl">✓</span>
            </div>
            <span className="text-sm">{t("noErrors")}</span>
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}

interface ErrorLog {
  id: string
  timestamp: string
  statusCode: number
  model: string
  errorMessage: string
  errorCode?: string
}

function ErrorRow({ error }: { error: ErrorLog }) {
  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 transition-all",
        "hover:border-red-500/30 hover:bg-red-500/10"
      )}
    >
      {/* Status Code Badge */}
      <div className="flex-shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/20">
          <span className="text-sm font-bold text-red-400">
            {error.statusCode}
          </span>
        </div>
      </div>

      {/* Error Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <time dateTime={error.timestamp}>{formatTime(error.timestamp)}</time>
          <span>|</span>
          <span className="font-mono">{error.model}</span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-[var(--foreground)]">
          {error.errorMessage || getErrorMessage(error.statusCode)}
        </p>
        {error.errorCode && (
          <span className="mt-1 inline-block rounded bg-red-500/20 px-2 py-0.5 text-xs font-mono text-red-300">
            {error.errorCode}
          </span>
        )}
      </div>
    </div>
  )
}

// Helper Functions
function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return `${diffInSeconds}s ago`
  }
  if (diffInSeconds < 3600) {
    return `${Math.floor(diffInSeconds / 60)}m ago`
  }
  if (diffInSeconds < 86400) {
    return `${Math.floor(diffInSeconds / 3600)}h ago`
  }

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getErrorMessage(statusCode: number): string {
  const messages: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  }
  return messages[statusCode] || "Unknown Error"
}
