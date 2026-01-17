import * as React from "react"
import useSWRInfinite from "swr/infinite"

import type { ApiError } from "@/lib/http"
import { swrFetcher, type SWRResult } from "@/lib/swr/fetcher"
import type { CursorPage } from "@/types/pagination"
import type { ConversationSessionItem, ConversationSessionsQuery } from "@/lib/api/conversations"

type ConversationSessionsState = {
  items: ConversationSessionItem[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error?: ApiError
  loadMore: () => void
  reset: () => void
  mutate: SWRResult<CursorPage<ConversationSessionItem>>["mutate"]
}

export function useConversationSessions(
  query: ConversationSessionsQuery = {},
  options: { enabled?: boolean } = {}
): ConversationSessionsState {
  const pageSize = query.size ?? 20

  const getKey = React.useCallback(
    (pageIndex: number, previousPageData: CursorPage<ConversationSessionItem> | null) => {
      if (options.enabled === false) {
        return null
      }
      if (previousPageData && !previousPageData.next_page) {
        return null
      }
      const cursor =
        pageIndex === 0 ? (query.cursor ?? null) : previousPageData?.next_page
      return [
        "/api/v1/internal/conversations",
        {
          params: {
            cursor,
            size: pageSize,
            assistant_id: query.assistant_id ?? undefined,
            status: query.status ?? undefined,
          },
        },
      ]
    },
    [options.enabled, pageSize, query.assistant_id, query.status, query.cursor]
  )

  const {
    data,
    error,
    isLoading,
    size,
    setSize,
    mutate,
  } = useSWRInfinite<CursorPage<ConversationSessionItem>, ApiError>(getKey, swrFetcher, {
    revalidateOnFocus: false,
  })

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
