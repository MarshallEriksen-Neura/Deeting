import * as React from "react"
import useSWR from "swr"

import type { ApiError } from "@/lib/http"
import { swrFetcher } from "@/lib/swr/fetcher"
import type { PluginMarketSkillItem } from "@/lib/api/plugin-market"

export function usePluginMarket(query?: { q?: string; limit?: number }) {
  const key = React.useMemo(() => {
    const params: Record<string, string | number> = {}
    if (query?.q) params.q = query.q
    if (query?.limit) params.limit = query.limit

    return Object.keys(params).length > 0
      ? ["/api/v1/plugin-market/plugins", { params }]
      : "/api/v1/plugin-market/plugins"
  }, [query?.q, query?.limit])

  const { data, error, isLoading, isValidating, mutate } = useSWR<
    PluginMarketSkillItem[],
    ApiError
  >(key, swrFetcher, { revalidateOnFocus: false })

  return {
    plugins: data ?? [],
    isLoading,
    isValidating,
    error,
    mutate,
  }
}
