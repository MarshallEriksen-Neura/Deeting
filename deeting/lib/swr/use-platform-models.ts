import useSWR from "swr"
import { fetchCreditsModels } from "@/lib/api/credits"
import type { CreditsPlatformModelsResponse } from "@/lib/api/credits"

export function usePlatformModels() {
  const { data, error, isLoading, mutate } = useSWR<CreditsPlatformModelsResponse>(
    "/api/v1/credits/models",
    fetchCreditsModels,
    {
      refreshInterval: 60000,
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  )

  return {
    models: data?.models ?? [],
    error,
    isLoading,
    mutate,
  }
}
