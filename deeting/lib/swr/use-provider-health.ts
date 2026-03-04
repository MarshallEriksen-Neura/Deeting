import useSWR from "swr"
import { fetchProviderHealth } from "@/lib/api/dashboard"
import type { DashboardDataSource, ProviderHealth } from "@/lib/api/dashboard"

/**
 * SWR hook for fetching provider health status
 *
 * Real-time monitoring of upstream provider availability
 */
export function useProviderHealth(options?: { source?: DashboardDataSource }) {
  const source = options?.source ?? "auto"
  const { data, error, isLoading, mutate } = useSWR<ProviderHealth[]>(
    ["/api/v1/dashboard/provider-health", source],
    () => fetchProviderHealth({ source }),
    {
      refreshInterval: 15000, // Refresh every 15s for real-time monitoring
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  )

  return {
    data,
    error,
    isLoading,
    mutate,
  }
}
