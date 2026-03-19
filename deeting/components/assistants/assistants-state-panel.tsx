"use client"

import * as React from "react"
import {
  AlertTriangle,
  Bot,
  FilterX,
  Loader2,
  RefreshCw,
  SearchSlash,
  Sparkles,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type AssistantsStateKind = "loading" | "error" | "empty"

interface AssistantsStatePanelProps {
  kind: AssistantsStateKind
  isFiltered?: boolean
  onRetry?: () => void
  onClearFilters?: () => void
  onCreate?: () => void
  errorMessage?: string | null
  className?: string
}

function AssistantsStateGlyph({ kind }: { kind: AssistantsStateKind }) {
  if (kind === "loading") {
    return (
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-primary/20" />
        <div className="absolute inset-3 rounded-full border border-primary/15" />
        <div className="absolute inset-6 rounded-full border border-primary/10" />
        <div className="absolute inset-0 animate-pulse rounded-full bg-primary/8 blur-2xl" />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    )
  }

  if (kind === "error") {
    return (
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-destructive/10 blur-2xl" />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-primary/8 blur-2xl" />
      <div className="absolute -right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-background shadow-md">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-background text-primary shadow-lg">
        <Bot className="h-6 w-6" />
      </div>
    </div>
  )
}

export function AssistantsStatePanel({
  kind,
  isFiltered = false,
  onRetry,
  onClearFilters,
  onCreate,
  errorMessage,
  className,
}: AssistantsStatePanelProps) {
  const t = useTranslations("assistants")

  const copy = React.useMemo(() => {
    if (kind === "loading") {
      return {
        badge: t("state.loading.badge"),
        title: t("state.loading.title"),
        description: t("state.loading.description"),
      }
    }

    if (kind === "error") {
      return {
        badge: t("state.error.badge"),
        title: t("state.error.title"),
        description: t("state.error.description"),
      }
    }

    if (isFiltered) {
      return {
        badge: t("state.empty.filteredBadge"),
        title: t("state.empty.filteredTitle"),
        description: t("state.empty.filteredDescription"),
      }
    }

    return {
      badge: t("state.empty.badge"),
      title: t("state.empty.title"),
      description: t("state.empty.description"),
    }
  }, [isFiltered, kind, t])

  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-[28px] border-border/60 bg-background/90 py-0 shadow-[0_28px_80px_-40px_rgba(109,40,217,0.35)]",
        className
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.16),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(236,72,153,0.12),transparent_38%)]" />
      <div className="absolute -left-10 top-10 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -right-10 bottom-0 h-40 w-40 rounded-full bg-pink-500/10 blur-3xl" />

      <CardContent className="relative flex flex-col items-center px-8 py-12 text-center sm:px-12">
        <AssistantsStateGlyph kind={kind} />

        <Badge
          variant="secondary"
          className="mt-6 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground"
        >
          {copy.badge}
        </Badge>

        <h3 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          {copy.title}
        </h3>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
          {copy.description}
        </p>

        {kind === "loading" ? (
          <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="rounded-2xl border border-border/60 bg-background/70 p-4 text-left shadow-sm"
              >
                <div className="h-2 w-12 animate-pulse rounded-full bg-primary/20" />
                <div className="mt-4 h-3 w-3/4 animate-pulse rounded-full bg-muted" />
                <div className="mt-2 h-3 w-1/2 animate-pulse rounded-full bg-muted/80" />
              </div>
            ))}
          </div>
        ) : null}

        {kind === "error" && errorMessage ? (
          <Alert
            variant="destructive"
            className="mt-8 max-w-2xl rounded-2xl border-destructive/20 bg-background/85 text-left"
          >
            <AlertTriangle />
            <AlertTitle>{t("state.error.detailsTitle")}</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {kind === "error" && onRetry ? (
            <Button onClick={onRetry} className="rounded-full px-5">
              <RefreshCw className="h-4 w-4" />
              {t("state.actions.retry")}
            </Button>
          ) : null}

          {kind === "empty" && isFiltered && onClearFilters ? (
            <Button onClick={onClearFilters} variant="outline" className="rounded-full px-5">
              <FilterX className="h-4 w-4" />
              {t("state.actions.clearFilters")}
            </Button>
          ) : null}

          {kind === "empty" && !isFiltered && onCreate ? (
            <Button onClick={onCreate} className="rounded-full px-5">
              <Sparkles className="h-4 w-4" />
              {t("state.actions.create")}
            </Button>
          ) : null}
        </div>

        {kind === "empty" && isFiltered ? (
          <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <SearchSlash className="h-4 w-4" />
            <span>{t("state.empty.filteredHint")}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

