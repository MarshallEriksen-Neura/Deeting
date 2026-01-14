"use client"

import * as React from "react"
import { Copy, MoreVertical, Pencil, RefreshCw, Trash2, Check } from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import {
  type ApiKey,
  type ApiKeyStatus,
  getStatusColor,
  calculateBudgetPercentage,
  formatRelativeTime,
} from "@/lib/api/api-keys"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { KeyIdenticon } from "./key-identicon"

interface ApiKeyStripProps extends React.HTMLAttributes<HTMLDivElement> {
  apiKey: ApiKey
  onEdit?: (key: ApiKey) => void
  onRoll?: (key: ApiKey) => void
  onRevoke?: (key: ApiKey) => void
}

/**
 * ApiKeyStrip - Glassmorphism data strip component for API key display
 *
 * Design features:
 * - Frosted glass effect with subtle border
 * - Status indicator glow on left edge
 * - Identicon for visual key recognition
 * - Usage progress bar
 * - Dropdown actions menu
 */
export function ApiKeyStrip({
  apiKey,
  onEdit,
  onRoll,
  onRevoke,
  className,
  ...props
}: ApiKeyStripProps) {
  const t = useTranslations("apiKeys")
  const [copied, setCopied] = React.useState(false)
  const menuId = React.useMemo(() => `apikey-${apiKey.id}-menu`, [apiKey.id])
  const statusColors = getStatusColor(apiKey.status)
  const budgetPercentage = calculateBudgetPercentage(apiKey.budget_used, apiKey.budget_limit)
  const relativeTime = formatRelativeTime(apiKey.last_used_at)

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.prefix)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  const isDisabled = apiKey.status === "revoked" || apiKey.status === "expired"

  return (
    <div
      className={cn(
        "group relative",
        "rounded-2xl overflow-hidden",
        "bg-[var(--card)]/80 dark:bg-[var(--card)]/60 backdrop-blur-xl",
        "border border-[var(--border)]",
        "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-0.5 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)]",
        isDisabled && "opacity-60",
        className
      )}
      {...props}
    >
      {/* Status indicator glow line */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl",
          statusColors.bg,
          statusColors.glow
        )}
      />

      {/* Top shine effect */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/5 dark:via-white/10 to-transparent"
      />

      {/* Content */}
      <div className="flex items-center gap-4 p-4 pl-5">
        {/* Identicon */}
        <KeyIdenticon keyId={apiKey.id} size="default" />

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[var(--foreground)] truncate">
              {apiKey.name}
            </h3>
            <StatusBadge status={apiKey.status} />
          </div>

          {/* Masked key with copy button */}
          <div className="flex items-center gap-2 mt-1">
            <code className="text-sm font-mono text-[var(--muted-foreground)] bg-[var(--muted-surface)] px-2 py-0.5 rounded">
              {apiKey.prefix}••••••••
            </code>
            <button
              onClick={handleCopyId}
              className={cn(
                "inline-flex items-center justify-center size-6 rounded-md",
                "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                "hover:bg-[var(--foreground)]/10",
                "transition-colors duration-200"
              )}
              title={t("actions.copy")}
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Usage progress */}
        {apiKey.budget_limit !== null && (
          <div className="hidden sm:flex flex-col items-end gap-1 min-w-[120px]">
            <span className="text-xs text-[var(--muted-foreground)]">
              ${apiKey.budget_used.toFixed(2)} / ${apiKey.budget_limit.toFixed(2)}
            </span>
            <Progress
              value={budgetPercentage}
              className={cn(
                "h-1.5 w-full",
                budgetPercentage > 80 && "[&>div]:bg-amber-500",
                budgetPercentage > 95 && "[&>div]:bg-red-500"
              )}
            />
          </div>
        )}

        {/* Last used */}
        <div className="hidden md:flex flex-col items-end min-w-[80px]">
          <span className="text-xs text-[var(--muted-foreground)]">{t("list.lastUsed")}</span>
          <span className="text-sm text-[var(--foreground)]">
            {relativeTime ? `${relativeTime} ${t("list.ago")}` : t("list.never")}
          </span>
        </div>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            id={`${menuId}-trigger`}
            aria-controls={`${menuId}-content`}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-40"
            id={`${menuId}-content`}
            aria-labelledby={`${menuId}-trigger`}
          >
            <DropdownMenuItem
              onClick={() => onEdit?.(apiKey)}
              disabled={isDisabled}
            >
              <Pencil className="size-4 mr-2" />
              {t("actions.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onRoll?.(apiKey)}
              disabled={isDisabled}
            >
              <RefreshCw className="size-4 mr-2" />
              {t("actions.roll")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onRevoke?.(apiKey)}
              disabled={isDisabled}
              className="text-red-500 focus:text-red-500"
            >
              <Trash2 className="size-4 mr-2" />
              {t("actions.revoke")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ApiKeyStatus }) {
  const t = useTranslations("apiKeys.status")
  const colors = getStatusColor(status)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        "bg-[var(--foreground)]/5"
      )}
    >
      {/* Glow dot */}
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inset-0 rounded-full animate-ping",
            colors.bg,
            "opacity-75"
          )}
          style={{ animationDuration: "2s" }}
        />
        <span className={cn("relative rounded-full size-2", colors.bg)} />
      </span>
      <span className={colors.text}>{t(status)}</span>
    </span>
  )
}

export default ApiKeyStrip
