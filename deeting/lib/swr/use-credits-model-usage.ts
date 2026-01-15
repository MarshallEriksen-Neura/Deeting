import useSWR from "swr"
import { fetchCreditsModelUsage } from "@/lib/api/credits"
import type { CreditsModelUsage } from "@/lib/api/credits"

export function useCreditsModelUsage(days: number = 30) {
  const { data, error, isLoading, mutate } = useSWR<CreditsModelUsage>(
    ["/api/v1/credits/model-usage", days],
    () => fetchCreditsModelUsage({ days }),
    {
      refreshInterval: 60000,
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  )

  return {
    data,
    error,
    isLoading,
    mutate,
  }
}
