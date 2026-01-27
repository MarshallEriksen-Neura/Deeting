import * as React from "react"
import useSWRInfinite from "swr/infinite"

import type { ApiError } from "@/lib/http"
import { swrFetcher, type SWRResult } from "@/lib/swr/fetcher"
import type { CursorPage } from "@/types/pagination"
import type {
  VideoGenerationTaskListItem,
} from "@/lib/api/video-generation"

type VideoGenerationTasksQuery = {
    cursor?: string
    size?: number
    status?: string
    include_outputs?: boolean
    session_id?: string
}

type VideoGenerationTasksState = {
  items: VideoGenerationTaskListItem[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error?: ApiError
  loadMore: () => void
  reset: () => void
  mutate: SWRResult<CursorPage<VideoGenerationTaskListItem>>["mutate"]
}

export function useVideoGenerationTasks(
  query: VideoGenerationTasksQuery = {},
  options: { enabled?: boolean } = {}
): VideoGenerationTasksState {
  const pageSize = query.size ?? 20

  const getKey = React.useCallback(
    (
      pageIndex: number,
      previousPageData: CursorPage<VideoGenerationTaskListItem> | null
    ) => {
      if (options.enabled === false) {
        return null
      }
      if (previousPageData && !previousPageData.next_page) {
        return null
      }
      const cursor =
        pageIndex === 0 ? (query.cursor ?? null) : previousPageData?.next_page
      return [
        "/api/v1/internal/videos/generations",
        {
          params: {
            cursor,
            size: pageSize,
            status: query.status ?? undefined,
            include_outputs: query.include_outputs ?? undefined,
            session_id: query.session_id ?? undefined,
          },
        },
      ]
    },
    [
      options.enabled,
      pageSize,
      query.cursor,
      query.include_outputs,
      query.status,
      query.session_id,
    ]
  )

  const {
    data,
    error,
    isLoading,
    size,
    setSize,
    mutate,
  } = useSWRInfinite<CursorPage<VideoGenerationTaskListItem>, ApiError>(getKey, swrFetcher, {
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
