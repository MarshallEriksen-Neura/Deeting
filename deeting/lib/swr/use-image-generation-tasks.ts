import * as React from "react"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"

import type {
  ImageGenerationTaskDetail,
  ImageGenerationTaskListItem,
  ImageGenerationTasksQuery,
} from "@/lib/api/image-generation"
import type { ApiError } from "@/lib/http"
import { swrFetcher } from "@/lib/swr/fetcher"
import type { CursorPage } from "@/types/pagination"

type ImageGenerationTasksState = {
  items: ImageGenerationTaskListItem[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error?: ApiError
  loadMore: () => void
  reset: () => void
  mutate: () => Promise<unknown>
}

export function useImageGenerationTasks(
  query: ImageGenerationTasksQuery = {},
  options: { enabled?: boolean } = {}
): ImageGenerationTasksState {
  const pageSize = query.size ?? 20

  const getKey = React.useCallback(
    (
      pageIndex: number,
      previousPageData: CursorPage<ImageGenerationTaskListItem> | null
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
        "/api/v1/internal/images/generations",
        {
          params: {
            cursor,
            size: pageSize,
            status: query.status ?? undefined,
            include_outputs: query.include_outputs ?? undefined,
            session_id: query.session_id ?? undefined,
          },
        },
      ] as const
    },
    [
      options.enabled,
      pageSize,
      query.cursor,
      query.include_outputs,
      query.session_id,
      query.status,
    ]
  )

  const {
    data,
    error,
    isLoading,
    size,
    setSize,
    mutate,
  } = useSWRInfinite<CursorPage<ImageGenerationTaskListItem>, ApiError>(
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

  const refresh = React.useCallback(() => mutate(), [mutate])

  return {
    items,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    reset,
    mutate: refresh,
  }
}

export function useImageGenerationTask(
  taskId: string | null | undefined,
  options: { enabled?: boolean; includeOutputs?: boolean } = {}
) {
  const includeOutputs = options.includeOutputs ?? true

  return useSWR<ImageGenerationTaskDetail, ApiError>(
    taskId && options.enabled !== false
      ? [
          `/api/v1/internal/images/generations/${taskId}`,
          {
            params: { include_outputs: includeOutputs },
          },
        ]
      : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
    }
  )
}
