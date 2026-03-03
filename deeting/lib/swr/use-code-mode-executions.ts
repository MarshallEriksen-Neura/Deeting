import * as React from "react"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"

import type { ApiError } from "@/lib/http"
import { type SWRResult } from "@/lib/swr/fetcher"
import type { CursorPage } from "@/types/pagination"
import type {
  CodeModeExecutionItem,
  CodeModeExecutionDetail,
  CodeModeExecutionsQuery,
} from "@/lib/api/code-mode"
import {
  fetchCodeModeExecution,
  fetchCodeModeExecutions,
} from "@/lib/api/code-mode"

// ── Paginated list hook ─────────────────────────────────────

type CodeModeExecutionsState = {
  items: CodeModeExecutionItem[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error?: ApiError
  loadMore: () => void
  reset: () => void
  mutate: SWRResult<CursorPage<CodeModeExecutionItem>>["mutate"]
}

export function useCodeModeExecutions(
  query: CodeModeExecutionsQuery = {},
  options: { enabled?: boolean } = {}
): CodeModeExecutionsState {
  const pageSize = query.size ?? 20

  const getKey = React.useCallback(
    (
      pageIndex: number,
      previousPageData: CursorPage<CodeModeExecutionItem> | null
    ) => {
      if (options.enabled === false) return null
      if (previousPageData && !previousPageData.next_page) return null

      const cursor =
        pageIndex === 0 ? (query.cursor ?? null) : previousPageData?.next_page

      return {
        cursor,
        size: pageSize,
        status: query.status ?? undefined,
        session_id: query.session_id ?? undefined,
      }
    },
    [options.enabled, pageSize, query.cursor, query.status, query.session_id]
  )

  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite<
    CursorPage<CodeModeExecutionItem>,
    ApiError
  >(
    getKey,
    async (q: CodeModeExecutionsQuery) => {
      return fetchCodeModeExecutions(q)
    },
    {
    revalidateOnFocus: false,
    }
  )

  const items = React.useMemo(() => {
    if (!data) return []
    return data.flatMap((page) => page.items || [])
  }, [data])

  const hasMore = React.useMemo(() => {
    if (!data || data.length === 0) return false
    return Boolean(data[data.length - 1]?.next_page)
  }, [data])

  const isLoadingMore =
    isLoading || (size > 0 && !!data && typeof data[size - 1] === "undefined")

  const loadMore = React.useCallback(() => {
    if (hasMore) {
      setSize(size + 1)
    }
  }, [hasMore, setSize, size])

  const reset = React.useCallback(() => {
    setSize(1)
  }, [setSize])

  return {
    items,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    reset,
    mutate,
  }
}

// ── Single execution detail hook ────────────────────────────

type CodeModeExecutionDetailState = {
  data: CodeModeExecutionDetail | undefined
  isLoading: boolean
  error?: ApiError
  mutate: SWRResult<CodeModeExecutionDetail>["mutate"]
}

export function useCodeModeExecutionDetail(
  identifier: string | null,
  options: { enabled?: boolean } = {}
): CodeModeExecutionDetailState {
  const key = options.enabled !== false && identifier ? identifier : null

  const { data, error, isLoading, mutate } = useSWR<
    CodeModeExecutionDetail,
    ApiError
  >(
    key,
    async (id: string) => {
      return fetchCodeModeExecution(id)
    },
    {
    revalidateOnFocus: false,
    }
  )

  return { data, isLoading, error, mutate }
}
