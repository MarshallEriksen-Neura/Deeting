import * as React from "react"
import useSWR from "swr"

import type { ApiError } from "@/lib/http"
import { swrFetcher } from "@/lib/swr/fetcher"
import { AssistantListResponseSchema, type AssistantDTO } from "@/lib/api/assistants"

export function useAssistantOwned(size = 20) {
  const key = ["/api/v1/assistants/owned", { params: { cursor: null, size } }]
  const { data, error, isLoading, mutate } = useSWR<
    { items: AssistantDTO[]; next_cursor?: string | null; size?: number },
    ApiError
  >(key, swrFetcher, { revalidateOnFocus: false })

  const items = React.useMemo(() => {
    if (!data) return []
    return AssistantListResponseSchema.parse(data).items
  }, [data])

  return {
    items,
    isLoading,
    error,
    mutate,
  }
}
