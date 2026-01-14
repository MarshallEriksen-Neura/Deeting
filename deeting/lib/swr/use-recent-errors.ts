import useSWR from "swr"
import { fetchRecentErrors } from "@/lib/api/dashboard"
import type { RecentError } from "@/lib/api/dashboard"

/**
 * SWR hook for fetching recent errors
 *
 * @param limit - Maximum number of errors to fetch (default: 10)
 */
export function useRecentErrors(limit = 10) {
  const { data, error, isLoading, mutate } = useSWR<RecentError[]>(
    ["/api/v1/dashboard/recent-errors", limit],
    () => fetchRecentErrors({ limit }),
    {
      refreshInterval: 20000, // Refresh every 20s
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
