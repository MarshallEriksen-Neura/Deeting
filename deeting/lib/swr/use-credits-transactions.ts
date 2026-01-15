import useSWR from "swr"
import { fetchCreditsTransactions } from "@/lib/api/credits"
import type { CreditsTransactions } from "@/lib/api/credits"

export function useCreditsTransactions(params?: { limit?: number; offset?: number }) {
  const limit = params?.limit ?? 20
  const offset = params?.offset ?? 0
  const { data, error, isLoading, mutate } = useSWR<CreditsTransactions>(
    ["/api/v1/credits/transactions", limit, offset],
    () => fetchCreditsTransactions({ limit, offset }),
    {
      refreshInterval: 30000,
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
