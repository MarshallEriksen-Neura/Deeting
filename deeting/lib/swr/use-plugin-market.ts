import * as React from "react"
import useSWR from "swr"

import type { ApiError } from "@/lib/http"
import { fetchPluginMarket, type PluginMarketSkillItem } from "@/lib/api/plugin-market"

export function usePluginMarket(query?: { q?: string; limit?: number }) {
  const key = React.useMemo(() => {
    return ["plugin-market", query?.q ?? "", query?.limit ?? 0]
  }, [query?.q, query?.limit])

  const { data, error, isLoading, isValidating, mutate } = useSWR<
    PluginMarketSkillItem[],
    ApiError
  >(key, () => fetchPluginMarket(query ?? {}), { revalidateOnFocus: false })

  return {
    plugins: data ?? [],
    isLoading,
    isValidating,
    error,
    mutate,
  }
}
