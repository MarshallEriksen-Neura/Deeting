import * as React from "react"
import useSWRInfinite from "swr/infinite"

import type { ApiError } from "@/lib/http"
import { swrFetcher } from "@/lib/swr/fetcher"
import type { CursorPage } from "@/types/pagination"
import {
  type AssistantMarketItem,
  type AssistantMarketQuery,
} from "@/lib/api/assistants"

type AssistantMarketState = {
  items: AssistantMarketItem[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error?: ApiError
  loadMore: () => void
  reset: () => void
  mutate: (...args: any[]) => Promise<unknown>
}

export function useAssistantMarket(
  query: AssistantMarketQuery,
  options?: { enabled?: boolean }
): AssistantMarketState {
  const enabled = options?.enabled ?? true
  const pageSize = query.size ?? 8
  const tagsKey = (query.tags || []).join("|")

  const getKey = React.useCallback(
    (pageIndex: number, previousPageData: CursorPage<AssistantMarketItem> | null) => {
      if (!enabled) {
        return null
      }
      if (previousPageData && !previousPageData.next_page) {
        return null
      }
      const cursor = pageIndex === 0 ? null : previousPageData?.next_page
      return [
        "/api/v1/assistants/market",
        {
          params: {
            cursor,
            size: pageSize,
            q: query.q || undefined,
            tags: query.tags || undefined,
          },
        },
      ] as const
    },
    [enabled, pageSize, query.q, tagsKey]
  )

  const {
    data,
    error,
    isLoading,
    size,
    setSize,
    mutate,
  } = useSWRInfinite<CursorPage<AssistantMarketItem>, ApiError>(
    getKey,
    swrFetcher,
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
