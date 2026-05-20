import useSWR from "swr"
import { fetchCreditsModels } from "@/lib/api/credits"
import type { CreditsPlatformModelsResponse } from "@/lib/api/credits"
import { isTauriRuntime } from "@/lib/runtime/tauri"

export function usePlatformModels() {
  const enabled = !isTauriRuntime()
  const { data, error, isLoading, mutate } = useSWR<CreditsPlatformModelsResponse>(
    enabled ? "/api/v1/credits/models" : null,
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
