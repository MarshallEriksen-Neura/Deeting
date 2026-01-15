import useSWR from "swr"
import { fetchCreditsConsumption } from "@/lib/api/credits"
import type { CreditsConsumption } from "@/lib/api/credits"

export function useCreditsConsumption(days: number = 30) {
  const { data, error, isLoading, mutate } = useSWR<CreditsConsumption>(
    ["/api/v1/credits/consumption", days],
    () => fetchCreditsConsumption({ days }),
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
