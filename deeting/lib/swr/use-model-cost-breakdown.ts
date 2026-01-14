import useSWR from "swr"
import { fetchModelCostBreakdown } from "@/lib/api/monitoring"
import type { ModelCostBreakdown } from "@/lib/api/monitoring"

/**
 * SWR hook for fetching model cost breakdown
 */
export function useModelCostBreakdown() {
  const { data, error, isLoading, mutate } = useSWR<ModelCostBreakdown>(
    "/api/v1/monitoring/model-cost-breakdown",
    fetchModelCostBreakdown,
    {
      refreshInterval: 60000, // Refresh every 60s
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
