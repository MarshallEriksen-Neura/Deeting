"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { GlassCard } from "@/components/ui/glass-card"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  MoreHorizontal,
} from "lucide-react"

export interface ColumnDef<T> {
  key: string
  header: string
  sortable?: boolean
  align?: "left" | "center" | "right"
  width?: string
  render?: (row: T, index: number) => React.ReactNode
}

interface AdminDataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  emptyMessage?: string
  pageSize?: number
  className?: string
  onRowClick?: (row: T) => void
  rowActions?: (row: T) => React.ReactNode
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AdminDataTable<T extends Record<string, any>>({
  columns,
  data,
  emptyMessage,
  pageSize = 10,
  className,
  onRowClick,
  rowActions,
}: AdminDataTableProps<T>) {
  const t = useTranslations("admin.common")
  const resolvedEmptyMessage = emptyMessage ?? t("noData")
  const [currentPage, setCurrentPage] = React.useState(1)
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")

  const sortedData = React.useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null || bVal == null) return 0
      const cmp = String(aVal).localeCompare(String(bVal), undefined, {
        numeric: true,
      })
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize))
  const paginatedData = sortedData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
    setCurrentPage(1)
  }

  return (
    <GlassCard padding="none" hover="none" className={cn("overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]",
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                      ? "text-center"
                      : "text-left",
                    col.width
                  )}
                >
                  {col.sortable ? (
                    <button
                      className="inline-flex cursor-pointer items-center gap-1 hover:text-[var(--foreground)] transition-colors"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.header}
                      <ArrowUpDown className="size-3 opacity-50" />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
              {rowActions && (
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("actions")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (rowActions ? 1 : 0)}
                  className="px-4 py-16 text-center text-[var(--muted)]"
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className="size-12 rounded-full bg-white/5 flex items-center justify-center">
                      <MoreHorizontal className="size-5 text-[var(--muted)]" />
                    </div>
                    <span>{resolvedEmptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedData.map((row, idx) => (
                <tr
                  key={idx}
                  className={cn(
                    "border-b border-white/5 transition-colors",
                    "hover:bg-white/[0.02]",
                    onRowClick && "cursor-pointer"
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-[var(--foreground)]",
                        col.align === "right"
                          ? "text-right"
                          : col.align === "center"
                          ? "text-center"
                          : "text-left"
                      )}
                    >
                      {col.render
                        ? col.render(row, (currentPage - 1) * pageSize + idx)
                        : (row[col.key] as React.ReactNode) ?? "—"}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="px-4 py-3 text-right">{rowActions(row)}</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data.length > pageSize && (
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
          <span className="text-xs text-[var(--muted)]">
            {t("pagination.showingOf", {
              start: (currentPage - 1) * pageSize + 1,
              end: Math.min(currentPage * pageSize, data.length),
              total: data.length,
            })}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)] disabled:opacity-30 transition-colors cursor-pointer"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(1)}
            >
              <ChevronsLeft className="size-4" />
            </button>
            <button
              className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)] disabled:opacity-30 transition-colors cursor-pointer"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let page: number
              if (totalPages <= 5) {
                page = i + 1
              } else if (currentPage <= 3) {
                page = i + 1
              } else if (currentPage >= totalPages - 2) {
                page = totalPages - 4 + i
              } else {
                page = currentPage - 2 + i
              }
              return (
                <button
                  key={page}
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-lg text-xs font-medium transition-colors cursor-pointer",
                    page === currentPage
                      ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                      : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]"
                  )}
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </button>
              )
            })}
            <button
              className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)] disabled:opacity-30 transition-colors cursor-pointer"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)] disabled:opacity-30 transition-colors cursor-pointer"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              <ChevronsRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </GlassCard>
  )
}
