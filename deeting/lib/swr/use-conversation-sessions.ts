import * as React from "react"
import useSWRInfinite from "swr/infinite"

import type { ApiError } from "@/lib/http"
import {
  fetchConversationSessions,
  type ConversationSessionPage,
  type ConversationSessionItem,
  type ConversationSessionsQuery,
} from "@/lib/api/conversations"
import { useAuthStore } from "@/store/auth-store"

type ConversationSessionsState = {
  items: ConversationSessionItem[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error?: ApiError
  loadMore: () => void
  reset: () => void
  mutate: () => Promise<unknown>
}

type SessionKey = readonly [
  "conversation-sessions",
  ConversationSessionsQuery,
]

export function useConversationSessions(
  query: ConversationSessionsQuery = {},
  options: { enabled?: boolean } = {}
): ConversationSessionsState {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isTauriRuntime = React.useMemo(
    () =>
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
    []
  )
  const requiresAuth = !isTauriRuntime
  const pageSize = query.size ?? 20

  const getKey = React.useCallback(
    (
      pageIndex: number,
      previousPageData: ConversationSessionPage | null
    ): SessionKey | null => {
      if (options.enabled === false || (requiresAuth && !isAuthenticated)) {
        return null
      }
      if (previousPageData && !previousPageData.next_page) {
        return null
      }
      const cursor =
        pageIndex === 0 ? (query.cursor ?? null) : previousPageData?.next_page
      return [
        "conversation-sessions",
        {
          cursor,
          size: pageSize,
          assistant_id: query.assistant_id ?? undefined,
          status: query.status ?? undefined,
        },
      ] as const
    },
    [
      options.enabled,
      requiresAuth,
      isAuthenticated,
      pageSize,
      query.assistant_id,
      query.status,
      query.cursor,
    ]
  )

  const {
    data,
    error,
    isLoading,
    size,
    setSize,
    mutate,
  } = useSWRInfinite<ConversationSessionPage, ApiError>(
    getKey,
    (key) => {
      const [, params] = key as SessionKey
      return fetchConversationSessions(params)
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

  const revalidate = React.useCallback(() => mutate(), [mutate])

  return {
    items,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    reset,
    mutate: revalidate,
  }
}
