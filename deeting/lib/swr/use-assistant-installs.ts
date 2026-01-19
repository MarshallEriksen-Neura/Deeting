import * as React from "react"
import useSWR from "swr"

import type { ApiError } from "@/lib/http"
import { swrFetcher } from "@/lib/swr/fetcher"
import { AssistantInstallPageSchema, type AssistantInstallItem } from "@/lib/api/assistants"

export function useAssistantInstalls(size = 20) {
  const key = ["/api/v1/assistants/installs", { params: { cursor: null, size } }]
  const { data, error, isLoading, mutate } = useSWR<
    { items: AssistantInstallItem[]; next_page?: string | null },
    ApiError
  >(key, swrFetcher, { revalidateOnFocus: false })

  const items = React.useMemo(() => {
    if (!data) return []
    return AssistantInstallPageSchema.parse(data).items
  }, [data])

  return {
    items,
    isLoading,
    error,
    mutate,
  }
}
