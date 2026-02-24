"use client"

import { useState, useMemo, useCallback, memo } from "react"
import { ArrowUpDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { NativeViewProps } from "./registry"

interface ColumnDef {
  key: string
  label?: string
  align?: "left" | "center" | "right"
}

interface TablePayload {
  columns: ColumnDef[]
  rows: Record<string, unknown>[]
}

function isValidPayload(data: unknown): data is TablePayload {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  return Array.isArray(d.columns) && Array.isArray(d.rows)
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type SortDir = "asc" | "desc" | null

const NativeTable = memo<NativeViewProps>(function NativeTable({ data }) {
  const t = useI18n("chat")
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [search, setSearch] = useState("")

  const payload = isValidPayload(data) ? data : null

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDir((prev) => (prev === "asc" ? "desc" : prev === "desc" ? null : "asc"))
        if (sortDir === "desc") setSortKey(null)
      } else {
        setSortKey(key)
        setSortDir("asc")
      }
    },
    [sortKey, sortDir]
  )

  const filteredRows = useMemo(() => {
    if (!payload) return []
    let rows = payload.rows
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter((row) =>
        payload.columns.some((col) =>
          formatCellValue(row[col.key]).toLowerCase().includes(q)
        )
      )
    }
    if (sortKey && sortDir) {
      rows = [...rows].sort((a, b) => {
        const va = a[sortKey]
        const vb = b[sortKey]
        if (va === vb) return 0
        if (va === null || va === undefined) return 1
        if (vb === null || vb === undefined) return -1
        if (typeof va === "number" && typeof vb === "number") {
          return sortDir === "asc" ? va - vb : vb - va
        }
        const sa = String(va)
        const sb = String(vb)
        return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa)
      })
    }
    return rows
  }, [payload, search, sortKey, sortDir])

  if (!payload) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        {t("views.invalidPayload")}
      </div>
    )
  }

  if (payload.rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center">
        {t("views.table.empty")}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("views.table.search")}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {payload.columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    "cursor-pointer select-none hover:bg-muted/50",
                    col.align === "center" && "text-center",
                    col.align === "right" && "text-right"
                  )}
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    <span>{col.label || col.key}</span>
                    <ArrowUpDown
                      size={12}
                      className={cn(
                        "shrink-0 transition-colors",
                        sortKey === col.key
                          ? "text-foreground"
                          : "text-muted-foreground/40"
                      )}
                    />
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={payload.columns.length}
                  className="text-center text-xs text-muted-foreground py-4"
                >
                  {t("views.table.noResults")}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {payload.columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        "text-xs",
                        col.align === "center" && "text-center",
                        col.align === "right" && "text-right"
                      )}
                    >
                      {formatCellValue(row[col.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Row count */}
      <div className="text-[10px] text-muted-foreground text-right">
        {filteredRows.length === payload.rows.length
          ? t("views.table.rowCount", { count: payload.rows.length })
          : t("views.table.filteredRowCount", {
              filtered: filteredRows.length,
              total: payload.rows.length,
            })}
      </div>
    </div>
  )
})

export default NativeTable
