"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Terminal } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { useGatewayLogs, useGatewayLogStats, type GatewayLogQuery } from "@/lib/swr/use-gateway-logs"

import { shortId } from "./logs-shared"
import { LogsDetailPanel } from "./logs-detail-panel"
import { LogsFilterBar, type LogsFilters } from "./logs-filter-bar"
import { LogsTable } from "./logs-table"

const INITIAL_FILTERS: LogsFilters = {
  model: "",
  statusCode: "all",
  cache: "all",
  errorCode: "",
  start: "",
  end: "",
  pageSize: "50",
}

export function LogsClient() {
  const t = useTranslations("logs")
  const locale = useLocale()
  const [filters, setFilters] = useState<LogsFilters>(INITIAL_FILTERS)
  const [cursor, setCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const query = useMemo<GatewayLogQuery>(() => {
    const next: GatewayLogQuery = {
      size: Number(filters.pageSize),
    }

    if (cursor) next.cursor = cursor
    if (filters.model.trim()) next.model = filters.model.trim()
    if (filters.errorCode.trim()) next.error_code = filters.errorCode.trim()
    if (filters.statusCode !== "all") next.status_code = Number(filters.statusCode)
    if (filters.cache === "hit") next.is_cached = true
    if (filters.cache === "miss") next.is_cached = false

    const startTime = toIsoString(filters.start)
    const endTime = toIsoString(filters.end)
    if (startTime) next.start_time = startTime
    if (endTime) next.end_time = endTime

    return next
  }, [filters, cursor])

  const { data, error, isLoading, isValidating, mutate } = useGatewayLogs(query, {
    keepPreviousData: true,
  })
  const { data: statsData, mutate: mutateStats } = useGatewayLogStats(query)

  const items = useMemo(() => data?.items ?? [], [data?.items])
  const effectiveSelectedId = selectedId && items.some((item) => item.id === selectedId)
    ? selectedId
    : (items[0]?.id ?? null)
  const selectedLog = items.find((item) => item.id === effectiveSelectedId) ?? null
  const activeFilterCount = useMemo(() => getActiveFilterCount(filters), [filters])

  const pageInfo = useMemo(() => {
    const pageSize = Number(filters.pageSize)
    const skip = cursor ? parseInt(cursor, 10) : 0
    const page = Math.floor(skip / pageSize) + 1
    const totalPages = statsData?.total ? Math.ceil(statsData.total / pageSize) : 1
    return { page, totalPages }
  }, [cursor, filters.pageSize, statsData?.total])

  return (
    <main className="-mb-[var(--shell-canvas-pb)] -mt-[var(--shell-canvas-pt)] -mx-[var(--shell-canvas-px)] flex h-[calc(100dvh-var(--shell-toolbar-h))] flex-col overflow-hidden bg-[var(--background)] font-mono text-[var(--ink-2)]">
      <header className="flex h-12 flex-none items-center justify-between border-b border-[var(--hairline)] bg-[var(--background)] px-4">
        <div className="flex items-center gap-3">
          <Terminal className="size-4 text-[var(--ok)]" />
          <span className="text-sm font-bold tracking-tighter text-[var(--ink)] uppercase">
            {t("header.title", { count: statsData?.total ?? items.length })}
          </span>
        </div>
        <div className="flex items-center gap-6 text-[10px] uppercase tracking-widest md:text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-[var(--ink-3)]">{t("header.filters")}</span>
            <span className={activeFilterCount > 0 ? "text-[var(--ok)]" : "text-[var(--ink-4)]"}>
              {activeFilterCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--ink-3)]">{t("header.selected")}</span>
            <span className="text-[var(--ok)]">{selectedLog ? shortId(selectedLog.id) : t("header.none")}</span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <LogsFilterBar
          value={filters}
          activeCount={activeFilterCount}
          onChange={(next) => {
            setFilters(next)
            setCursor(null)
          }}
          onRefresh={() => {
            void Promise.all([mutate(), mutateStats()])
          }}
          onReset={() => {
            setFilters(INITIAL_FILTERS)
            setCursor(null)
            setSelectedId(null)
          }}
          refreshing={isValidating}
        />

        {error ? (
          <div className="border-y border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-2 text-[12px] text-[var(--danger)]">
            {t("error.loadFailed", { message: error.message || t("error.unknown") })}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_560px]">
          <section className="flex min-h-0 flex-col border-r border-[var(--hairline)]">
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar-brutalist">
              <LogsTable
                items={items}
                isLoading={isLoading}
                selectedId={effectiveSelectedId}
                onSelect={(log) => setSelectedId(log.id)}
              />
            </div>

            <footer className="flex h-10 flex-none items-center justify-between border-t border-[var(--hairline)] bg-[var(--background)] px-4">
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-[var(--ink-4)]">{t("footer.pageInfoLabel", pageInfo)}</span>
                <span className="text-[var(--ink-2)]">{t("footer.items", { count: items.length })}</span>
                <span className="text-[var(--ink-2)]">{t("footer.size", { size: filters.pageSize })}</span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-none border border-[var(--hairline)] bg-transparent px-3 text-[10px] text-[var(--ink-2)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)] disabled:opacity-30 uppercase font-mono shadow-none"
                  disabled={!data?.previous_page || isValidating}
                  onClick={() => setCursor(data?.previous_page ?? null)}
                >
                  {t("footer.prev")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-none border border-[var(--hairline)] bg-transparent px-3 text-[10px] text-[var(--ink-2)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)] disabled:opacity-30 uppercase font-mono shadow-none"
                  disabled={!data?.next_page || isValidating}
                  onClick={() => setCursor(data?.next_page ?? null)}
                >
                  {t("footer.next")}
                </Button>
              </div>
            </footer>
          </section>

          <section className="min-h-0 bg-[var(--panel-bg-inset)]">
            <LogsDetailPanel log={selectedLog} locale={locale} />
          </section>
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar-brutalist::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar-brutalist::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar-brutalist::-webkit-scrollbar-thumb {
          background: var(--hairline-strong);
          border: 2px solid transparent;
          background-clip: content-box;
        }
        .custom-scrollbar-brutalist::-webkit-scrollbar-thumb:hover {
          background: var(--ink-4);
          background-clip: content-box;
        }
      `}</style>
    </main>
  )
}

function getActiveFilterCount(filters: LogsFilters) {
  let count = 0

  if (filters.model.trim()) count += 1
  if (filters.statusCode !== "all") count += 1
  if (filters.cache !== "all") count += 1
  if (filters.errorCode.trim()) count += 1
  if (filters.start) count += 1
  if (filters.end) count += 1
  if (filters.pageSize !== "50") count += 1

  return count
}

function toIsoString(value: string) {
  if (!value) return undefined

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined

  return date.toISOString()
}
